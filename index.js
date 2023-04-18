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
            // sometimes the task is not found, so we wait 10 seconds and try again
            await sleep(10000);
            result = await this.client.tasks.searchTasksForWorkspace(this.workspace_id, query);

            if (result.data.length == 0) {
                core.setFailed("Task not found");
            }
        } else if (result.data.length > 1) {
            core.setFailed("More than one task found");
        }
        return result.data[0].gid;
    }

    async createTask(issue_number, issue_url, issue_title, issue_assignee) {
        const task_assignee = await getUser(issue_assignee);
        let task_custom_fields = {};
        task_custom_fields[this.custom_field] = issue_number;

        await this.client.tasks.createTask({
            'workspace': this.workspace_id,
            'projects': [this.project_id],
            'name': issue_title,
            'notes': issue_url,
            'assignee': task_assignee,
            'custom_fields': task_custom_fields,
            'pretty': true
        });
    }

    async close_task(issue_number) {
        const task_gid = await this.find_task_gid(issue_number);

        await this.client.tasks.updateTask(task_gid, {
            'completed': true,
            'pretty': true
        });
    }

    async edit_task(issue_number, issue_title, issue_assignee, issue_state) {
        const task_gid = this.findTask(issue_number);
        const task_assignee = await getUser(issue_assignee);
        const task_completed = issue_state != null && issue_state == 'closed';

        await this.client.tasks.updateTask(task_gid, {
            'name': issue_title,
            'assignee': task_assignee,
            'completed': task_completed,
            'pretty': true
        });
    }
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

        const asana_client = AsanaClient(asana_secret, asana_workspace_id, asana_project_id, asana_custom_field);

        const github_issue = GitHubIssue(github.context.payload);

        if (action == 'open') {
            await asana_client.create_task(github_issue.number, github_issue.url, github_issue.title, github_issue.assignee);
        } else if (action == 'close') {
            await asana_client.close_task(github_issue.number);
        } else if (action == 'edit') {
            await asana_client.edit_task(github_issue.number, github_issue.title, github_issue.assignee, github_issue.state);
        // } else if (action == 'migrate') {
        //     await migrate(asana_client);
        } else {
            core.setFailed("Invalid action");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();