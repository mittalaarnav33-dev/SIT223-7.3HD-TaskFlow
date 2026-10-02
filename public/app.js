'use strict';
/* global TaskModel */
let allTasks = [];

/*
 * TaskFlow browser interface.
 * User-entered titles are assigned with textContent rather than innerHTML
 * so they are displayed as text and cannot become executable HTML.
 */

const list = document.querySelector('#task-list');
const message = document.querySelector('#message');

function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('error', isError);
}

// Reject failed HTTP responses instead of treating them as successful actions.
async function api(url, options = {}) {
    const response = await fetch(url, options);

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed: ${response.status}`);
    }

    return response.status === 204 ? null : response.json();
}

// Disable the action while it runs to prevent duplicate submissions.
async function perform(button, action, successMessage) {
    button.disabled = true;

    try {
        await action();
        await loadTasks();
        showMessage(successMessage);
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
}

function renderTask(task) {
    const row = document.createElement('li');
    row.className = task.completed ? 'task done' : 'task';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.setAttribute('aria-label', `Mark ${task.title} as completed`);

    checkbox.addEventListener('change', () => {
        const completed = checkbox.checked;

        // Restore the displayed state until the server confirms the change.
        checkbox.checked = task.completed;

        perform(checkbox, () => api(`/api/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed })
        }), 'Task updated.');
    });

    const content = document.createElement('div');
    content.className = 'task-content';

    const title = document.createElement('p');
    title.className = 'task-title';
    title.textContent = task.title;

    const created = document.createElement('time');
    created.dateTime = task.createdAt;
    created.textContent = `Created ${new Date(task.createdAt).toLocaleString()}`;

    const tags = document.createElement('div');
    tags.className = 'task-tags';
    const priority = document.createElement('span');
    priority.className = `priority ${task.priority || 'medium'}`;
    priority.textContent = `${task.priority || 'medium'} priority`;
    tags.append(priority);
    if (task.dueDate) {
        const due = document.createElement('span');
        due.className = TaskModel.overdue(task) ? 'due overdue' : 'due';
        due.textContent = `${TaskModel.overdue(task) ? 'Overdue · ' : 'Due '}${task.dueDate}`;
        tags.append(due);
    }
    content.append(title, tags, created);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete ${task.title}`);

    remove.addEventListener('click', () => {
        if (window.confirm(`Delete "${task.title}"?`)) {
            perform(remove, () => api(`/api/tasks/${task.id}`, {
                method: 'DELETE'
            }), 'Task deleted.');
        }
    });

    row.append(checkbox, content, remove);
    return row;
}

// Recompute the visible list locally; dashboard totals always cover all tasks.
function renderTasks() {
    const filters = {
        search: document.querySelector('#search').value,
        status: document.querySelector('#status-filter').value,
        priority: document.querySelector('#priority-filter').value,
        sort: document.querySelector('#sort').value
    };
    const visible = TaskModel.select(allTasks, filters);
    list.replaceChildren(...visible.map(renderTask));
    document.querySelector('#visible-count').textContent = visible.length;
    const stats = TaskModel.summary(allTasks);
    for (const [name, value] of Object.entries(stats)) {
        document.querySelector(`#${name}`).textContent = value;
    }
    const percent = stats.total ? Math.round(stats.completed / stats.total * 100) : 0;
    document.querySelector('#progress').value = percent;
    document.querySelector('#progress-text').textContent = `${percent}% complete`;
    document.querySelector('#progress-label').textContent =
        stats.total ? `${stats.completed} of ${stats.total} tasks completed` : 'A fresh start';
    const empty = document.querySelector('#empty');
    empty.hidden = visible.length > 0;
    empty.textContent = allTasks.length ? 'No tasks match these filters.' :
        'Your plan is a blank canvas. Add your first task above.';
}

async function loadTasks() {
    allTasks = await api('/api/tasks');
    renderTasks();
}

for (const id of ['search', 'status-filter', 'priority-filter', 'sort']) {
    document.querySelector(`#${id}`).addEventListener('input', renderTasks);
}
document.querySelector('#today-label').textContent = new Date().toLocaleDateString(
    undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
);

document.querySelector('#task-form').addEventListener('submit', event => {
    event.preventDefault();

    const input = document.querySelector('#title');
    const title = input.value.trim();

    if (!title) {
        showMessage('Enter a task title.', true);
        return;
    }

    perform(document.querySelector('#add-button'), async () => {
        await api('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title,
                priority: document.querySelector('#priority').value,
                dueDate: document.querySelector('#due-date').value || null })
        });
        document.querySelector('#task-form').reset();
        input.focus();
    }, 'Task created.');
});

document.querySelector('#refresh').addEventListener('click', () => {
    perform(document.querySelector('#refresh'), async () => {}, 'Tasks refreshed.');
});

// This status display is separate from the monitoring service added later.
async function checkHealth() {
    const badge = document.querySelector('#health');

    try {
        const health = await api('/health');
        badge.textContent = 'Server online';
        badge.className = 'badge online';
        document.querySelector('#environment').textContent =
            `${health.environment} · Version ${health.version}`;
    } catch {
        badge.textContent = 'Server unavailable';
        badge.className = 'badge offline';
    }
}

loadTasks().catch(error => showMessage(error.message, true));
checkHealth();
setInterval(() => { checkHealth(); renderTasks(); }, 15000);
