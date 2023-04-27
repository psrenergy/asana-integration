const core = require('@actions/core');
const github = require('@actions/github');
const asana = require('asana');

const users = {
    'guilhermebodin': '1204391944334606',
    'gvidigal-psr': '1204433497236007',
    'iurysab': '1204225355671418',
    'joaquimg': '1204149448752625',
    'pedroripper': '1204414685536664',
    'rafabench': '1204414416538056',
    'raphasampaio': '1204198676859382',
    'ricardo-psr': '1204278175940416',
    'rodrigodelpreti': '1204218382803581',
    'storino': '1204285451098195',
    'viniciusjusten': '1204414013512209',
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getUser(assignee) {
    if (assignee != null && assignee.hasOwnProperty('login')) {
        const login = assignee.login.toLowerCase();
        if (users.hasOwnProperty(login)) {
            return users[login];
        } else {
            core.setFailed(`User ${login} not found`);
        }
    }
    return null;
}

class GitHubIssue {
    constructor(payload) {
        core.debug(`GitHubIssue: ${JSON.stringify(payload)}`);

        this.number = payload.issue.number.toString();
        this.url = payload.issue.html_url;
        this.title = payload.issue.title;
        this.assignee = payload.issue.assignee;
        this.state = payload.issue.state;
    }
}

class GitHubIssueComment {
    constructor(payload) {
        core.debug(`GitHubIssueComment: ${JSON.stringify(payload)}`);

        this.number = payload.issue.number.toString();
        this.login = payload.comment.login;
    }
}

class AsanaClient {
    constructor(secret, workspace_id, project_id, github_column_id, participants_column_id) {
        this.client = asana.Client.create().useAccessToken(secret);
        this.workspace_id = workspace_id;
        this.project_id = project_id;
        this.github_column_id = github_column_id;
        this.participants_column_id = participants_column_id;
    }

    async findTask(issue_number) {
        let data = {
            'projects.all': this.project_id,
            'opt_pretty': true
        };
        data['custom_fields.' + this.github_column_id + '.value'] = issue_number;

        core.debug(`findTask: searchTasksForWorkspace: ${JSON.stringify(data)}`);
        let result = await this.client.tasks.searchTasksForWorkspace(this.workspace_id, data);

        if (result.data.length == 0) {
            core.debug(`findTask: task #${issue_number} not found, waiting 10 seconds and searching again`);

            await sleep(10000);

            core.debug(`findTask: searchTasksForWorkspace: ${JSON.stringify(data)}`);
            result = await this.client.tasks.searchTasksForWorkspace(this.workspace_id, data);

            if (result.data.length == 0) {
                core.debug(`findTask: task #${issue_number} not found`);
                return 0;
            }
        } else if (result.data.length > 1) {
            core.setFailed(`More than one task found for issue #${issue_number}`);
        }

        const gid = result.data[0].gid;
        core.debug(`findTask: task #${issue_number} found, gid: ${gid}`);
        return gid;
    }

    async getTask(task_gid) {
        let task = await this.client.tasks.getTask(task_gid, {
            opt_pretty: true
        });
        return task;
    }

    async getTaskParticipants(task_gid) {
        let participants = [];
        const task = await this.getTask(task_gid);
        if (task.hasOwnProperty("custom_fields")) {
            for (let custom_field of task.custom_fields) {
                if (custom_field.gid == this.participants_column_id) {
                    for (let person of custom_field.people_value) {
                        participants.push(person.gid);
                    }
                }
            }   
        }
        return participants;
    }

    async createTask(github_payload) {
        const github_issue = new GitHubIssue(github_payload);

        const task_gid = await this.findTask(github_issue.number);
        if (task_gid == 0) {
            core.debug(`createTask: task #${github_issue.number} not found, creating a new one`);

            const task_assignee = await getUser(github_issue.assignee);
            let task_custom_fields = {};
            task_custom_fields[this.github_column_id] = github_issue.number;
            task_custom_fields[this.participants_column_id] = task_assignee;

            core.debug(`createTask: task #${github_issue.number}, title: ${github_issue.title}, url: ${github_issue.url}, assignee: ${task_assignee}`);

            const data = {
                'workspace': this.workspace_id,
                'projects': [this.project_id],
                'name': github_issue.title,
                'notes': github_issue.url,
                'assignee': task_assignee,
                'custom_fields': task_custom_fields,
                'pretty': true
            };

            core.debug(`createTask: createTask: ${JSON.stringify(data)}`);
            const result = await this.client.tasks.createTask(data);
            core.debug(`createTask: ${result}`);
        } else {
            core.debug(`createTask: task #${github_issue} already exists, updating it`);
            await this.editTask(github_issue);
        }
    }

    async closeTask(github_payload) {
        const github_issue = new GitHubIssue(github_payload);

        const task_gid = await this.findTask(github_issue.number);
        if (task_gid == 0) {
            core.debug(`closeTask: task #${github_issue} not found, creating a new one`);
            await this.createTask(github_issue);
            task_gid = await this.findTask(github_issue.number);
        }

        core.debug(`closeTask: task #${github_issue}, title: ${github_issue.title}`);

        const data = {
            'completed': true,
            'pretty': true
        };

        core.debug(`closeTask: updateTask: ${JSON.stringify(data)}`);
        await this.client.tasks.updateTask(task_gid, data);
    }

    async editTask(github_payload) {
        const github_issue = new GitHubIssue(github_payload);

        let task_gid = await this.findTask(github_issue.number);
        if (task_gid == 0) {
            core.debug(`editTask: task #${github_issue.number} not found, creating a new one`);
            await this.createTask(github_issue);
            task_gid = await this.findTask(github_issue.number);
        }

        const task_assignee = await getUser(github_issue.assignee);
        const task_completed = github_issue.state != null && github_issue.state == 'closed';

        let task_participants = await this.getTaskParticipants(task_gid);
        task_participants.push(task_assignee);

        let task_custom_fields = {};
        task_custom_fields[this.github_column_id] = github_issue.number;
        task_custom_fields[this.participants_column_id] = task_participants;

        core.debug(`editTask: task ${task_gid}, issue #${github_issue.number}, title: ${github_issue.title}, assignee: ${task_assignee}, completed: ${task_completed}`);

        const data = {
            'name': github_issue.title,
            'assignee': task_assignee,
            'completed': task_completed,
            'custom_fields': task_custom_fields,
            'pretty': true
        };

        core.debug(`editTask: updateTask: ${JSON.stringify(data)}`);
        await this.client.tasks.updateTask(task_gid, data);
    }
}

async function addTaskParticipant(github_payload) {
    const github_issue_comment = new GitHubIssueComment(github_payload);

    const task_gid = await this.findTask(github_issue_comment.number);

    const task_assignee = await this.getUser(github_issue_comment.login);
    let task_participants = await this.getTaskParticipants(task_gid);
    task_participants.push(task_assignee);

    let task_custom_fields = {};
    task_custom_fields[this.github_column_id] = github_issue_comment.number;
    task_custom_fields[this.participants_column_id] = task_participants;

    core.debug(`addTaskParticipant: task ${task_gid}, issue #${github_issue_comment.number}, assignee: ${task_assignee}`);

    const data = {
        'custom_fields': task_custom_fields,
        'pretty': true
    };

    core.debug(`addTaskParticipant: updateTask: ${JSON.stringify(data)}`);
    await client.tasks.updateTask(task_gid, data);
}

// async function migrate(asana_client) {
//     console.log(github);

//     // console.log(process.env.GITHUB_TOKEN);

//     // const octokit = github.getOctokit();

//     // octokit.paginate(octokit.rest.issues.listForRepo, {})
//     //     .then(issues => {
//     //         console.log(issues);
//     //     });
// }

async function run() {
    try {
        const action = core.getInput('action');
        core.debug(`action: ${action}`);

        const asana_secret = core.getInput('asana-secret');
        const asana_workspace_id = core.getInput('asana-workspace-id');
        const asana_project_id = core.getInput('asana-project-id');
        const asana_github_column_id = '1204412546956914';
        const asana_participants_column_id = '1204488256461384';

        const asana_client = new AsanaClient(asana_secret, asana_workspace_id, asana_project_id, asana_github_column_id, asana_participants_column_id);

        if (action == 'open') {
            await asana_client.createTask(github.context.payload);
        } else if (action == 'close') {
            await asana_client.closeTask(github.context.payload);
        } else if (action == 'edit') {
            await asana_client.editTask(github.context.payload);
        } else if (action == 'add-participant') {
            await asana_client.addTaskParticipant(github.context.payload);
        } else {
            core.setFailed("Invalid action");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();