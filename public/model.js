'use strict';
/* global module */
// Pure planning logic is shared by the browser and automated regression tests.
// Compare date-only strings in the user's local calendar, avoiding UTC shifts.
const TaskModel = (() => {
    function today(now = new Date()) {
        return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0')].join('-');
    }
    function overdue(task, date = today()) {
        return !task.completed && Boolean(task.dueDate) && task.dueDate < date;
    }
    function summary(tasks, date = today()) {
        const completed = tasks.filter(task => task.completed).length;
        return { total: tasks.length, completed, pending: tasks.length - completed,
            overdue: tasks.filter(task => overdue(task, date)).length };
    }
    function matches(task, filters, date) {
        const statusMatches = {
            all: true, pending: !task.completed, completed: task.completed,
            overdue: overdue(task, date)
        };
        return statusMatches[filters.status] &&
            (filters.priority === 'all' || (task.priority || 'medium') === filters.priority) &&
            task.title.toLowerCase().includes(filters.search.trim().toLowerCase());
    }
    function select(tasks, filters, date = today()) {
        const ranks = { high: 0, medium: 1, low: 2 };
        const sorters = {
            newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
            priority: (a, b) => ranks[a.priority || 'medium'] - ranks[b.priority || 'medium'],
            due: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
        };
        // Filter creates a new array: sorting never changes the server's data order.
        return tasks.filter(task => matches(task, filters, date)).sort(sorters[filters.sort]);
    }
    return { today, overdue, summary, select };
})();
if (typeof module !== 'undefined') module.exports = TaskModel;
