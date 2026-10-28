import { libraryRoute } from '../../js/source-core.js?v=20261026-uploads';
import { projectRoute, ordered, projectProgress, moveIds, cleanName } from '../../js/project-core.js?v=20261026-projects';
import { createProjectStore } from '../../js/project-store.js?v=20261026-projects';
import { newMoneyId as newId } from '../../js/money-core.js?v=20261026-money';

export function createProjectView({root, editor, projects, repository, isSignedIn, signIn, openTasks}) {
  const $ = selector => root.querySelector(selector);
  let route = null, editing = null, returnFocus = '';
  let hubProject = '', hubExpanded = false;
  const store = createProjectStore(repository, {isSignedIn, changed:render});
  const {state} = store;
  const el = (tag, className, text) => {const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node;};
  function button(text, label, key, action, disabled = false) {
    const node = el('button', 'project-control', text); node.type = 'button'; node.setAttribute('aria-label', label); node.dataset.projectFocus = key;
    node.disabled = disabled || !ready(); node.addEventListener('click', action); return node;
  }
  const ready = () => isSignedIn() && state.data && !state.loading && !state.busy && !state.error;
  function meter(target, info) {
    target.replaceChildren();
    const caption = el('p', 'project-progress-label', info.label); target.append(caption);
    const bar = el('div', 'project-progress'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Task progress'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(info.percent)); bar.setAttribute('aria-valuetext', info.label);
    const fill = el('span'); fill.style.width = info.percent + '%'; bar.append(fill); target.append(bar);
  }
  function render() {
    if (!route) return;
    const focused = document.activeElement?.dataset.projectFocus;
    const project = projects.find(p => p.value === route.project);
    const data = state.data;
    root.dataset.theme = project.theme;
    $('#projectPhoto').src = '../' + project.image;
    $('#projectLibrary').href = libraryRoute(route.project);
    $('#projectEyebrow').textContent = project.note;
    $('#projectHeading').textContent = project.value === 'Health & Fitness' ? project.value : project.name;
    $('#projectStatus').textContent = !isSignedIn() ? 'Sign in to save your project tasks.' : state.loading ? 'Loading your project…' : state.notice;
    $('#projectError').textContent = state.error;
    $('#projectSignIn').hidden = isSignedIn(); $('#projectReload').hidden = !isSignedIn(); $('#projectReload').disabled = state.loading || state.busy;
    root.setAttribute('aria-busy', String(state.loading || state.busy));
    $('#projectOverall').hidden = !data;
    if (data) meter($('#projectOverall'), projectProgress(data));
    const modernHub = project.value !== 'Health & Fitness';
    root.classList.toggle('project-hub-enabled', modernHub && !route.section);
    if (hubProject !== route.project) {hubProject = route.project; hubExpanded = false;}
    root.classList.toggle('project-hub-expanded', hubExpanded);
    const hub = $('#projectHub');
    if (hub) {
      hub.hidden = !modernHub || !!route.section;
      hub.querySelector('[data-hub=todo]').setAttribute('aria-expanded', String(hubExpanded));
      hub.querySelector('[data-hub=todo]').setAttribute('aria-label', hubExpanded ? 'Hide project tasks by area' : 'Browse project tasks by area');
      hub.querySelector('[data-hub=buy]').setAttribute('aria-label', 'View planned purchases for ' + route.project);
      hub.querySelector('[data-hub=library]').href = libraryRoute(route.project);
    }
    $('#projectOverview').hidden = !!route.section;
    $('#projectSectionPage').hidden = !route.section;
    $('#projectAddSection').disabled = !ready();
    $('#projectSectionCards').replaceChildren();
    $('#projectEmpty').hidden = !data || !!data.sections.length;
    if (data) ordered(data.sections).forEach((section, index, sections) => {
      const li = el('li', 'project-section-card'); li.dataset.sectionId = section.id;
      const link = el('a', 'project-section-link'); link.href = projectRoute(route.project, section.id);
      link.append(el('h3', '', section.name)); const summary = el('div'); meter(summary, projectProgress(data, section.id)); link.append(summary); li.append(link);
      const controls = el('div', 'project-card-controls');
      controls.append(button('Rename', 'Rename ' + section.name, 'edit-' + section.id, () => showEditor('section', section)),
        button('↑', 'Move ' + section.name + ' up', 'up-' + section.id, () => reorder('sections', sections, section.id, -1), index === 0),
        button('↓', 'Move ' + section.name + ' down', 'down-' + section.id, () => reorder('sections', sections, section.id, 1), index === sections.length - 1),
        button('Delete', 'Delete subsection ' + section.name, 'delete-' + section.id, () => removeSection(section)));
      li.append(controls); $('#projectSectionCards').append(li);
    });
    $('#projectBack').href = projectRoute(route.project);
    $('#projectMilestones').replaceChildren();
    const section = data?.sections.find(s => s.id === route.section);
    $('#projectSectionContent').hidden = !section;
    $('#projectSectionMissing').hidden = !route.section || !data || !!section;
    if (section) {
      $('#projectSectionHeading').textContent = section.name;
      meter($('#projectSectionProgress'), projectProgress(data, section.id));
      $('#projectAddMilestone').disabled = !ready(); $('#projectRenameSection').disabled = !ready(); $('#projectDeleteSection').disabled = !ready();
      const milestones = ordered(data.milestones.filter(m => m.section_id === section.id));
      $('#projectMilestoneEmpty').hidden = !!milestones.length;
      milestones.forEach((milestone, index) => {
        const li = el('li', 'project-milestone' + (milestone.completed ? ' is-complete' : '')); li.dataset.milestoneId = milestone.id;
        const label = el('label', 'project-milestone-label'), check = el('input'); check.type = 'checkbox'; check.checked = milestone.completed; check.disabled = !ready(); check.dataset.projectFocus = 'check-' + milestone.id;
        check.addEventListener('change', () => store.save('complete_milestone', {id:milestone.id, section_id:section.id, completed:check.checked}));
        label.append(check, el('span', '', milestone.name)); li.append(label);
        const controls = el('div', 'project-milestone-controls');
        controls.append(button('Edit', 'Rename task ' + milestone.name, 'edit-' + milestone.id, () => showEditor('milestone', milestone)),
          button('↑', 'Move task ' + milestone.name + ' up', 'up-' + milestone.id, () => reorder('milestones', milestones, milestone.id, -1), index === 0),
          button('↓', 'Move task ' + milestone.name + ' down', 'down-' + milestone.id, () => reorder('milestones', milestones, milestone.id, 1), index === milestones.length - 1),
          button('Delete', 'Delete task ' + milestone.name, 'delete-' + milestone.id, async () => {
            if (confirm(`Delete milestone “${milestone.name}”? This removes only this milestone. Other milestones, projects and planner tasks will stay unchanged.`)) await store.save('delete_milestone', {id:milestone.id, section_id:section.id});
          }));
        li.append(controls); $('#projectMilestones').append(li);
      });
    }
    const form = editor.querySelector('form');
    if (editor.open) {
      form.querySelector('button[type=submit]').disabled = !ready();
      form.querySelector('input').disabled = state.busy;
      form.querySelector('[data-cancel]').disabled = state.busy;
      editor.querySelector('[role=alert]').textContent = state.error;
    }
    if (focused) [...root.querySelectorAll('[data-project-focus]')].find(n => n.dataset.projectFocus === focused && !n.disabled)?.focus({preventScroll:true});
  }
  async function reorder(kind, rows, id, direction) {
    await store.save('order_' + kind, {ids:moveIds(rows, id, direction), ...(kind === 'milestones' ? {section_id:route.section} : {})});
  }
  async function removeSection(section) {
    const count = state.data.milestones.filter(m => m.section_id === section.id).length;
    if (!confirm(`Delete subsection “${section.name}” and its ${count} milestone${count === 1 ? '' : 's'}? This cannot be undone. Other subsections, projects and planner tasks will stay unchanged. Any library sources assigned here will be kept in the project library without a subsection.`)) return;
    const project = route.project, inside = route.section === section.id;
    if (await store.save('delete_section', {id:section.id}) && inside && route?.project === project) location.hash = projectRoute(project);
  }
  function showEditor(kind, item = null) {
    if (!ready()) return;
    returnFocus = document.activeElement?.dataset.projectFocus || (kind === 'section' ? 'add-section' : 'add-milestone');
    editing = {kind, id:item?.id || newId(), section_id:kind === 'milestone' ? route.section : undefined};
    editor.querySelector('h2').textContent = (item ? 'Rename ' : 'Add ') + (kind === 'section' ? 'subsection' : 'milestone');
    editor.querySelector('[role=alert]').textContent = '';
    const input = editor.querySelector('input'); input.value = item?.name || ''; input.disabled = false;
    editor.querySelector('button[type=submit]').disabled = false; editor.querySelector('[data-cancel]').disabled = false;
    editor.showModal(); input.focus();
  }
  editor.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); if (!editing || !ready()) return;
    try {
      const name = cleanName(editor.querySelector('input').value), entry = editing;
      const success = await store.save('save_' + entry.kind, {id:entry.id, name, ...(entry.section_id ? {section_id:entry.section_id} : {})});
      if (success && editing === entry) editor.close();
    } catch (error) {editor.querySelector('[role=alert]').textContent = error.message;}
  });
  editor.querySelector('[data-cancel]').addEventListener('click', () => editor.close());
  editor.addEventListener('cancel', event => {if (state.busy) event.preventDefault();});
  editor.addEventListener('close', () => {editing = null; [...root.querySelectorAll('[data-project-focus]')].find(n => n.dataset.projectFocus === returnFocus)?.focus({preventScroll:true});});
  $('#projectSignIn').addEventListener('click', signIn);
  $('#projectReload').addEventListener('click', () => store.load(true));
  $('#projectAddSection').addEventListener('click', () => showEditor('section'));
  $('#projectAddMilestone').addEventListener('click', () => showEditor('milestone'));
  $('#projectRenameSection').addEventListener('click', () => showEditor('section', state.data.sections.find(s => s.id === route.section)));
  $('#projectDeleteSection').addEventListener('click', () => removeSection(state.data.sections.find(s => s.id === route.section)));
  const hub = document.createElement('nav');
  hub.id = 'projectHub'; hub.className = 'project-hub'; hub.setAttribute('aria-label', 'Project spaces');
  hub.innerHTML = '<button type="button" class="project-hub-card" data-hub="todo" aria-expanded="false"><span class="project-hub-art" aria-hidden="true"></span><span class="project-hub-icon" aria-hidden="true">✓</span><span class="project-hub-body"><strong>To Do</strong><small>Tasks and plans<br>for this project</small><span class="project-hub-arrow" aria-hidden="true">→</span></span></button><button type="button" class="project-hub-card" data-hub="buy"><span class="project-hub-art" aria-hidden="true"></span><span class="project-hub-icon" aria-hidden="true">⌑</span><span class="project-hub-body"><strong>To Buy</strong><small>Planned purchases<br>for this project</small><span class="project-hub-arrow" aria-hidden="true">→</span></span></button><a class="project-hub-card" data-hub="library"><span class="project-hub-art" aria-hidden="true"></span><span class="project-hub-icon" aria-hidden="true">▤</span><span class="project-hub-body"><strong>Library</strong><small>Ideas and<br>references</small><span class="project-hub-arrow" aria-hidden="true">→</span></span></a>';
  root.insertBefore(hub, $('#projectOverview'));
  hub.querySelector('[data-hub=todo]').addEventListener('click', () => {hubExpanded = !hubExpanded; render();});
  hub.querySelector('[data-hub=buy]').addEventListener('click', () => {
    const filter = document.getElementById('moneyProjectFilter');
    if (filter) filter.value = route.project;
    location.hash = '#money-purchases';
  });
  $('#projectTasks').addEventListener('click', () => openTasks(route.project));
  return {
    open(next) {
      if (route?.project !== next.project || route?.section !== next.section) {if (editor.open) editor.close();}
      route = next; store.select(next.project); render(); void store.load();
    },
    close() {if (editor.open) editor.close();},
    reset() {if (editor.open) editor.close(); store.reset();}
  };
}
