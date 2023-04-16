const core = require('@actions/core');
const github = require('@actions/github');
const asana = require('asana');

const usernames = {
    'raphasampaio': '1204198676859382',
};

async function open(asana_client, asana_workspace_id, asana_project_id, asana_custom_field) {
    console.log(github.context.payload);

    const issue_number = github.context.payload.issue.number.toString();
    const issue_url = github.context.payload.issue.html_url;
    const issue_title = github.context.payload.issue.title;

    let custom_fields = {};
    custom_fields[asana_custom_field] = issue_number;

    await asana_client.tasks.createTask({
        workspace: asana_workspace_id,
        projects: [asana_project_id],
        name: issue_title,
        notes: issue_url,
        custom_fields: custom_fields,
        pretty: true
    });
}

async function close(asana_client, asana_workspace_id, asana_project_id, asana_custom_field) {
    console.log(github.context.payload);

    const issue_number = github.context.payload.issue.number.toString();

    let query = {
        'projects.all': asana_project_id,
        opt_pretty: true
    };
    query['custom_fields.' + asana_custom_field + '.value'] = issue_number;

    let result = await asana_client.tasks.searchTasksForWorkspace(asana_workspace_id, query);
    if (result.data.length == 0) {
        core.setFailed("Task not found");
    } else if (result.data.length > 1) {
        core.setFailed("More than one task found");
    }

    const task_gid = result.data[0].gid;
    await asana_client.tasks.updateTask(task_gid, {
        completed: true,
        pretty: true
    });
}

async function edit(asana_client, asana_workspace_id, asana_project_id, asana_custom_field) {
    console.log(github.context.payload);

    const issue_number = github.context.payload.issue.number.toString();
    const issue_title = github.context.payload.issue.title;

    let query = {
        'projects.all': asana_project_id,
        opt_pretty: true
    };
    query['custom_fields.' + asana_custom_field + '.value'] = issue_number;

    let result = await asana_client.tasks.searchTasksForWorkspace(asana_workspace_id, query);
    if (result.data.length == 0) {
        core.setFailed("Task not found");
    } else if (result.data.length > 1) {
        core.setFailed("More than one task found");
    }

    const task_gid = result.data[0].gid;
    await asana_client.tasks.updateTask(task_gid, {
        name: issue_title,
        pretty: true
    });
}

async function run() {
    try {
        const action = core.getInput('action');

        const asana_secret = core.getInput('asana-secret');
        const asana_workspace_id = core.getInput('asana-workspace-id');
        const asana_project_id = core.getInput('asana-project-id');
        const asana_custom_field = core.getInput('asana-custom-field');
        const asana_client = asana.Client.create().useAccessToken(asana_secret);

        if (action == 'open') {
            await open(asana_client, asana_workspace_id, asana_project_id, asana_custom_field);
        } else if (action == 'close') {
            await close(asana_client, asana_workspace_id, asana_project_id, asana_custom_field);
        } else if (action == 'edit') {
            await edit(asana_client, asana_workspace_id, asana_project_id, asana_custom_field);
        } else {
            core.setFailed("Invalid action");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();