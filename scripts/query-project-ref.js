/**
 * Query Notion for project_ref items from the terminal.
 * Uses same config as the app (Arc Notion Sidebar userData) or env vars.
 *
 * Usage (from project root, littlebot/):
 *   node scripts/query-project-ref.js
 *
 * Or with env vars:
 *   set NOTION_API_KEY=your_key
 *   set NOTION_DATABASE_ID=your_db_id
 *   node scripts/query-project-ref.js
 */

const path = require('path');
const fs = require('fs').promises;

async function loadConfig() {
  if (process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID) {
    return {
      notionApiKey: process.env.NOTION_API_KEY,
      notionDatabaseId: process.env.NOTION_DATABASE_ID
    };
  }
  const appName = 'Arc Notion Sidebar';
  const configName = 'littlebot-config.json';
  const dir = process.env.APPDATA || (process.env.HOME && path.join(process.env.HOME, '.config')) || process.cwd();
  const configPath = path.join(dir, appName, configName);
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg.notionApiKey && cfg.notionDatabaseId) return cfg;
  } catch (_) {
    const localPath = path.join(process.cwd(), configName);
    try {
      const raw = await fs.readFile(localPath, 'utf8');
      const cfg = JSON.parse(raw);
      if (cfg.notionApiKey && cfg.notionDatabaseId) return cfg;
    } catch (_2) {}
  }
  throw new Error('Notion not configured. Set NOTION_API_KEY and NOTION_DATABASE_ID, or run the app once so littlebot-config.json exists in ' + configPath);
}

async function main() {
  const config = await loadConfig();
  const notion = require('../notion-manager');
  notion.configure(config.notionApiKey, config.notionDatabaseId);

  const schema = await notion.getDatabaseSchema();
  const titleProp = schema.properties.find(p => p.type === 'title');
  const dateProp = schema.properties.find(p => p.type === 'date');
  const typeProp = schema.properties.find(p => (p.type === 'select' || p.type === 'status') && (p.name === 'Type' || (p.name && p.name.toLowerCase().includes('type'))));
  const projectRefProp = schema.properties.find(p => {
    if (typeof p.name !== 'string') return false;
    const nameMatch = p.name === 'project_ref' || p.name === 'Project' || p.name.toLowerCase().replace(/\s+/g, '_').includes('project');
    return nameMatch && (p.type === 'relation' || p.type === 'select' || p.type === 'multi_select');
  });

  const typePropName = typeProp ? typeProp.name : 'Type';
  if (!titleProp) {
    console.error('No title property in database');
    process.exit(1);
  }
  console.log('Schema: title=%s, date=%s, type=%s', titleProp.name, dateProp?.name, typePropName);
  console.log('project_ref: %s (type=%s)', projectRefProp?.name || '(none)', projectRefProp?.type || 'n/a');
  if (projectRefProp?.options?.length) console.log('project_ref options:', projectRefProp.options.join(', '));
  console.log('');

  const projectTypeFilter = typeProp && typeProp.type === 'status'
    ? { property: typePropName, status: { equals: 'Project' } }
    : { property: typePropName, select: { equals: 'Project' } };
  let projectRows = await notion.queryDatabase({ and: [projectTypeFilter] });
  if (projectRows.length === 0 && (!typeProp || typeProp.type === 'select')) {
    projectRows = await notion.queryDatabase({ and: [{ property: typePropName, select: { equals: 'project' } }] });
  }

  const taskTypeFilter = typeProp && typeProp.type === 'status'
    ? { property: typePropName, status: { equals: 'Task' } }
    : { property: typePropName, select: { equals: 'Task' } };
  const recentStart = new Date();
  recentStart.setDate(recentStart.getDate() - 30);
  const recentStartISO = recentStart.toISOString().slice(0, 10);
  const recentSorts = dateProp ? [{ property: dateProp.name, direction: 'descending' }] : null;

  if (projectRefProp && (projectRefProp.type === 'select' || projectRefProp.type === 'multi_select') && projectRefProp.options?.length) {
    console.log('Project_ref types (select/multi_select):', projectRefProp.options.length);
    const refFilter = projectRefProp.type === 'multi_select'
      ? (value) => ({ property: projectRefProp.name, multi_select: { contains: value } })
      : (value) => ({ property: projectRefProp.name, select: { equals: value } });
    for (const optionName of projectRefProp.options) {
      const filter = {
        and: [
          taskTypeFilter,
          refFilter(optionName),
          ...(dateProp ? [{ property: dateProp.name, date: { on_or_after: recentStartISO } }] : [])
        ]
      };
      const tasks = await notion.queryDatabase(filter, recentSorts);
      console.log('\n---', optionName);
      console.log('  Recent tasks:', tasks.length);
      tasks.slice(0, 5).forEach((t, i) => {
        const tTitle = t.properties[titleProp.name] || 'Untitled';
        const dv = t.properties[dateProp?.name];
        const dateStr = dv?.start ? (dv.start.includes('T') ? new Date(dv.start).toLocaleString() : dv.start) : '(no date)';
        console.log('    ', i + 1, tTitle, '|', dateStr);
      });
      if (tasks.length > 5) console.log('    ... and', tasks.length - 5, 'more');
    }
    return;
  }

  if (projectRefProp && projectRefProp.type === 'relation') {
    console.log('Projects (Type=Project):', projectRows.length);
    for (const proj of projectRows) {
      const title = proj.properties[titleProp.name] || 'Untitled';
      console.log('\n---', title, '(', proj.id, ')');
      const filter = {
        and: [
          taskTypeFilter,
          { property: projectRefProp.name, relation: { contains: proj.id } },
          ...(dateProp ? [{ property: dateProp.name, date: { on_or_after: recentStartISO } }] : [])
        ]
      };
      const tasks = await notion.queryDatabase(filter, recentSorts);
      console.log('  Tasks linked via relation:', tasks.length);
      tasks.slice(0, 5).forEach((t, i) => {
        const tTitle = t.properties[titleProp.name] || 'Untitled';
        const dv = t.properties[dateProp?.name];
        const dateStr = dv?.start ? (dv.start.includes('T') ? new Date(dv.start).toLocaleString() : dv.start) : '(no date)';
        console.log('    ', i + 1, tTitle, '|', dateStr);
      });
      if (tasks.length > 5) console.log('    ... and', tasks.length - 5, 'more');
    }
    return;
  }

  console.log('Projects (Type=Project):', projectRows.length);
  console.log('(No project_ref relation/select/multi_select found for grouping.)');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
