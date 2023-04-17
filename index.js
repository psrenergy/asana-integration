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

function get_user(assignee) {
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function get_task_gid(asana_client, asana_workspace_id, asana_project_id, asana_custom_field, issue_number) {
    let query = {
        'projects.all': asana_project_id,
        'opt_pretty': true
    };
    query['custom_fields.' + asana_custom_field + '.value'] = issue_number;

    let result = await asana_client.tasks.searchTasksForWorkspace(asana_workspace_id, query);
    if (result.data.length == 0) {
        await sleep(10000);
        result = await asana_client.tasks.searchTasksForWorkspace(asana_workspace_id, query);

        if (result.data.length == 0) {
            core.setFailed("Task not found");
        }
    } else if (result.data.length > 1) {
        core.setFailed("More than one task found");
    }
    return result.data[0].gid;
}

async function open(asana_client, asana_workspace_id, asana_project_id, asana_custom_field) {
    const issue_number = github.context.payload.issue.number.toString();
    const issue_url = github.context.payload.issue.html_url;
    const issue_title = github.context.payload.issue.title;
    const issue_assignee = github.context.payload.issue.assignee;

    const task_assignee = await get_user(issue_assignee);
    let task_custom_fields = {};
    task_custom_fields[asana_custom_field] = issue_number;

    await asana_client.tasks.createTask({
        'workspace': asana_workspace_id,
        'projects': [asana_project_id],
        'name': issue_title,
        'notes': issue_url,
        'assignee': task_assignee,
        'custom_fields': task_custom_fields,
        'pretty': true
    });
}

async function close(asana_client, asana_workspace_id, asana_project_id, asana_custom_field) {
    const issue_number = github.context.payload.issue.number.toString();

    const task_gid = await get_task_gid(asana_client, asana_workspace_id, asana_project_id, asana_custom_field, issue_number);

    await asana_client.tasks.updateTask(task_gid, {
        'completed': true,
        'pretty': true
    });
}

async function edit(asana_client, asana_workspace_id, asana_project_id, asana_custom_field) {
    const issue_number = github.context.payload.issue.number.toString();
    const issue_title = github.context.payload.issue.title;
    const issue_assignee = github.context.payload.issue.assignee;
    const issue_state = github.context.payload.issue.state;

    const task_gid = await get_task_gid(asana_client, asana_workspace_id, asana_project_id, asana_custom_field, issue_number);
    const task_assignee = await get_user(issue_assignee);
    const task_completed = issue_state != null && issue_state == 'closed';

    await asana_client.tasks.updateTask(task_gid, {
        'name': issue_title,
        'assignee': task_assignee,
        'completed': task_completed,
        'pretty': true
    });
}

async function migrate(asana_client, asana_workspace_id, asana_project_id, asana_custom_field) {
    console.log(github);

    console.log(process.env.GITHUB_TOKEN);

    const octokit = github.getOctokit();


    octokit.paginate(octokit.rest.issues.listForRepo, {})
        .then(issues => {
            console.log(issues);
        });
}

async function run() {
    try {
        const action = core.getInput('action');

        const asana_secret = core.getInput('asana-secret');
        const asana_workspace_id = core.getInput('asana-workspace-id');
        const asana_project_id = core.getInput('asana-project-id');
        const asana_custom_field = '1204412546956914';
        const asana_client = asana.Client.create().useAccessToken(asana_secret);

        if (action == 'open') {
            await open(asana_client, asana_workspace_id, asana_project_id, asana_custom_field);
        } else if (action == 'close') {
            await close(asana_client, asana_workspace_id, asana_project_id, asana_custom_field);
        } else if (action == 'edit') {
            await edit(asana_client, asana_workspace_id, asana_project_id, asana_custom_field);
        } else if (action == 'migrate') {
            await migrate(asana_client, asana_workspace_id, asana_project_id, asana_custom_field);
        } else {
            core.setFailed("Invalid action");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();