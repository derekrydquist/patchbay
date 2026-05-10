import Database from 'better-sqlite3';

const db = new Database('./patchbay.db');

const ASSIGNEES: Record<string, string> = {
  'Bass':    'Alex',
  'Drums':   'Jamie',
  'Guitar 1': 'Sam',
  'Guitar 2': 'Jordan',
  'Vocals':  'Taylor',
};

const today = new Date('2026-05-09');

function randomDueDate(): string {
  const offset = Math.floor(Math.random() * 61); // 0–60 days
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const tasks = db.prepare('SELECT id, instrument FROM production_tasks').all() as { id: string; instrument: string }[];

const update = db.prepare('UPDATE production_tasks SET assignee = ?, due_date = ? WHERE id = ?');

const runAll = db.transaction(() => {
  for (const task of tasks) {
    const assignee = ASSIGNEES[task.instrument] ?? 'Alex';
    const dueDate = randomDueDate();
    update.run(assignee, dueDate, task.id);
  }
});

runAll();

console.log(`Updated ${tasks.length} tasks.`);

// Verify
const sample = db.prepare(`
  SELECT instrument, assignee, due_date
  FROM production_tasks
  ORDER BY instrument, due_date
  LIMIT 15
`).all();

console.table(sample);
