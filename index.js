const core = require('@actions/core');
const github = require('@actions/github');
const asana = require('asana');

const users = {
    'raphasampaio': '1204198676859382',
    'iurysab': '1204225355671418',
    'storino': '1204285451098195',
    'viniciusjusten': '1204414013512209',
    'guilhermebodin': '1204391944334606',
    'pedroripper': '1204414685536664'
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
        this.number = payload.issue.number.toString();
        this.url = payload.issue.html_url;
        this.title = payload.issue.title;
        this.assignee = payload.issue.assignee;
        this.state = payload.issue.state;
    }
}

class AsanaClient {
    constructor(secret, workspace_id, project_id, custom_field) {
        this.client = asana.Client.create().useAccessToken(secret);
        this.workspace_id = workspace_id;
        this.project_id = project_id;
        this.custom_field = custom_field;
    }

    async findTask(issue_number) {
        let query = {
            'projects.all': this.project_id,
            'opt_pretty': true
        };
        query['custom_fields.' + this.custom_field + '.value'] = issue_number;

        let result = await this.client.tasks.searchTasksForWorkspace(this.workspace_id, query);

        if (result.data.length == 0) {
            if (core.isDebug()) {
                core.debug(`findTask: task #${issue_number} not found, waiting 10 seconds and searching again`);
            }

            await sleep(10000);
            result = await this.client.tasks.searchTasksForWorkspace(this.workspace_id, query);
            if (result.data.length == 0) {
                if (core.isDebug()) {
                    core.debug(`findTask: task #${issue_number} not found`);
                }
                return 0;
            }
        } else if (result.data.length > 1) {
            core.setFailed(`More than one task found for issue #${issue_number}`);
        }

        const gid = result.data[0].gid;
        if (core.isDebug()) {
            core.debug(`findTask: task #${issue_number} found, gid: ${gid}`);
        }
        return gid;
    }

    async createTask(github_issue) {
        const task_gid = await this.findTask(github_issue.number);
        if (task_gid == 0) {
            if (core.isDebug()) {
                core.debug(`createTask: task #${github_issue.number} not found, creating a new one`);
            }

            const task_assignee = await getUser(github_issue.assignee);
            let task_custom_fields = {};
            task_custom_fields[this.custom_field] = github_issue.number;

            if (core.isDebug()) {
                core.debug(`createTask: task #${github_issue.number}, title: ${github_issue.title}, url: ${github_issue.url}, assignee: ${task_assignee}`);
            }
    
            await this.client.tasks.createTask({
                'workspace': this.workspace_id,
                'projects': [this.project_id],
                'name': github_issue.title,
                'notes': github_issue.url,
                'assignee': task_assignee,
                'custom_fields': task_custom_fields,
                'pretty': true
            });
        } else {
            if (core.isDebug()) {
                core.debug(`createTask: task #${github_issue} already exists, updating it`);
            }
            await this.editTask(github_issue);
        }
    }

    async closeTask(github_issue) {
        const task_gid = await this.findTask(github_issue.number);
        if (task_gid == 0) {
            if (core.isDebug()) {
                core.debug(`closeTask: task #${github_issue} not found, creating a new one`);
            }
            await this.createTask(github_issue);
            task_gid = await this.findTask(github_issue.number);
        }

        if (core.isDebug()) {
            core.debug(`closeTask: task #${github_issue}, title: ${github_issue.title}`);
        }

        await this.client.tasks.updateTask(task_gid, {
            'completed': true,
            'pretty': true
        });
    }

    async editTask(github_issue) {
        let task_gid = await this.findTask(github_issue.number);
        if (task_gid == 0) {
            if (core.isDebug()) {
                core.debug(`editTask: task #${github_issue.number} not found, creating a new one`);
            }
            await this.createTask(github_issue);
            task_gid = await this.findTask(github_issue.number);
        }

        const task_assignee = await getUser(github_issue.assignee);
        const task_completed = github_issue.state != null && github_issue.state == 'closed';

        if (core.isDebug()) {
            core.debug(`editTask: task ${task_gid}, issue #${github_issue.number}, title: ${github_issue.title}, assignee: ${task_assignee}, completed: ${task_completed}`);
        }

        await this.client.tasks.updateTask(task_gid, {
            'name': github_issue.title,
            'assignee': task_assignee,
            'completed': task_completed,
            'pretty': true
        });
    }
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

        const asana_secret = core.getInput('asana-secret');
        const asana_workspace_id = core.getInput('asana-workspace-id');
        const asana_project_id = core.getInput('asana-project-id');
        const asana_custom_field = '1204412546956914';

        const asana_client = new AsanaClient(asana_secret, asana_workspace_id, asana_project_id, asana_custom_field);

        const github_issue = new GitHubIssue(github.context.payload);

        if (action == 'open') {
            await asana_client.createTask(github_issue);
        } else if (action == 'close') {
            await asana_client.closeTask(github_issue);
        } else if (action == 'edit') {
            await asana_client.editTask(github_issue);
        } else {
            core.setFailed("Invalid action");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();