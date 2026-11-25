export function installTabs(strip, t) {
  const $ = id => document.getElementById(id);
  const tabDialog = $('tab-dialog'), groupDialog = $('group-dialog');
  const select = $('tab-group-select'), nameField = $('group-name');
  let selectedTab, editingGroup, groupId = 0;
  let dragged, dropMarker;

  const groups = () => [...strip.children].filter(node => node.classList.contains('tab-group'));
  const groupOf = tab => tab.closest('.tab-group');
  const groupName = group => group.firstElementChild.textContent;

  function removeEmpty(group) {
    if (group && !group.querySelector('.tab')) group.remove();
  }

  function assign(tab, group) {
    const previous = groupOf(tab);
    if (group === previous) return;
    if (group) group.append(tab);
    else previous?.after(tab);
    removeEmpty(previous);
  }

  function move(tab, direction) {
    const target = direction < 0 ? tab.previousElementSibling : tab.nextElementSibling;
    if (!target || target.classList.contains('tab-group-label')) return;
    if (direction < 0) target.before(tab);
    else target.after(tab);
  }

  function openActions(tab) {
    selectedTab = tab;
    $('tab-actions-name').textContent = tab.querySelector('.tab-label').textContent;
    select.replaceChildren(new Option(t('tabs.noGroup'), ''));
    for (const group of groups()) select.add(new Option(groupName(group), group.dataset.group));
    select.value = groupOf(tab)?.dataset.group || '';
    $('tab-move-earlier').disabled = !tab.previousElementSibling || tab.previousElementSibling.classList.contains('tab-group-label');
    $('tab-move-later').disabled = !tab.nextElementSibling;
    tabDialog.showModal();
  }

  function openGroup(group) {
    editingGroup = group;
    $('group-title').textContent = t(group ? 'tabs.editGroup' : 'tabs.newGroup');
    $('group-ungroup').hidden = !group;
    nameField.setCustomValidity('');
    nameField.value = group ? groupName(group) : '';
    groupDialog.showModal();
    nameField.select();
  }

  function createGroup(tab, name) {
    const group = document.createElement('div');
    group.className = 'tab-group';
    group.dataset.group = String(++groupId);
    group.dataset.color = String((groupId - 1) % 6);
    group.setAttribute('role', 'group');
    const label = document.createElement('button');
    label.type = 'button'; label.className = 'tab-group-label';
    label.draggable = true;
    label.onclick = () => openGroup(group);
    label.oncontextmenu = event => { event.preventDefault(); openGroup(group); };
    group.append(label);
    (groupOf(tab) || tab).before(group);
    assign(tab, group);
    nameGroup(group, name);
  }

  function nameGroup(group, name) {
    const label = group.firstElementChild;
    label.textContent = name;
    label.title = name;
    group.setAttribute('aria-label', name);
  }

  select.onchange = () => {
    assign(selectedTab, groups().find(group => group.dataset.group === select.value) || null);
    tabDialog.close();
  };
  $('tab-group-new').onclick = () => { tabDialog.close(); openGroup(null); };
  for (const [id, direction] of [['tab-move-earlier', -1], ['tab-move-later', 1]]) {
    $(id).onclick = () => { move(selectedTab, direction); tabDialog.close(); };
  }
  nameField.oninput = () => nameField.setCustomValidity('');
  $('group-form').onsubmit = event => {
    event.preventDefault();
    const name = nameField.value.trim();
    if (!name) {
      nameField.setCustomValidity(t('tabs.groupNameRequired'));
      nameField.reportValidity();
      return;
    }
    if (editingGroup) nameGroup(editingGroup, name);
    else if (selectedTab?.isConnected) createGroup(selectedTab, name);
    groupDialog.close();
  };
  $('group-ungroup').onclick = () => {
    if (!editingGroup) return;
    const tabs = [...editingGroup.querySelectorAll('.tab')];
    editingGroup.replaceWith(...tabs);
    groupDialog.close();
    tabs[0]?.querySelector('.tab-label').focus();
  };
  tabDialog.addEventListener('close', () => {
    if (!tabDialog.open && !groupDialog.open) selectedTab = null;
  });
  groupDialog.addEventListener('close', () => {
    if (groupDialog.open) return;
    const target = editingGroup?.firstElementChild || selectedTab?.querySelector('.tab-actions');
    if (target?.isConnected && !document.querySelector('dialog[open]')) target.focus();
    editingGroup = null;
    if (!tabDialog.open) selectedTab = null;
  });

  function clearDrop() {
    if (dropMarker) delete dropMarker.dataset.drop;
    dropMarker = null;
  }

  function destination(event) {
    const hit = event.target.closest('.tab, .tab-group-label');
    if (!hit) return { target: strip, position: 'end' };
    if (dragged.contains(hit)) return null;
    const grouping = dragged.classList.contains('tab-group');
    if (!grouping && hit.classList.contains('tab-group-label')) {
      return { target: hit, position: 'into' };
    }
    const target = grouping ? groupOf(hit) || hit : hit;
    if (target === dragged) return null;
    const bounds = target.getBoundingClientRect();
    return { target, position: event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after' };
  }

  strip.addEventListener('dragstart', event => {
    dragged = event.target.closest('.tab-label')?.closest('.tab') ||
      event.target.closest('.tab-group-label')?.parentElement;
    if (!dragged) { event.preventDefault(); return; }
    dragged.classList.add('tab-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-terminal-tab', 'move');
  });
  strip.addEventListener('dragover', event => {
    if (!dragged?.isConnected) return;
    const drop = destination(event);
    clearDrop();
    if (!drop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    dropMarker = drop.target;
    dropMarker.dataset.drop = drop.position;
  });
  strip.addEventListener('dragleave', event => {
    if (!strip.contains(event.relatedTarget)) clearDrop();
  });
  strip.addEventListener('drop', event => {
    if (!dragged?.isConnected) return;
    event.preventDefault();
    const drop = destination(event);
    if (!drop) return;
    const previous = dragged.classList.contains('tab') ? groupOf(dragged) : null;
    if (drop.position === 'end') strip.append(dragged);
    else if (drop.position === 'into') drop.target.parentElement.append(dragged);
    else if (drop.position === 'before') drop.target.before(dragged);
    else drop.target.after(dragged);
    removeEmpty(previous);
    clearDrop();
  });
  strip.addEventListener('dragend', () => {
    dragged?.classList.remove('tab-dragging');
    dragged = null;
    clearDrop();
  });

  return {
    add(tab, key) {
      tab.dataset.key = String(key);
      tab.querySelector('.tab-label').draggable = true;
      const actions = document.createElement('button');
      actions.className = 'tab-actions'; actions.type = 'button'; actions.textContent = '⋯';
      actions.dataset.i18nLabel = actions.dataset.i18nTitle = 'tabs.actions';
      actions.title = t('tabs.actions'); actions.setAttribute('aria-label', actions.title);
      actions.onclick = () => openActions(tab);
      tab.insertBefore(actions, tab.querySelector('.tab-close'));
      tab.oncontextmenu = event => { event.preventDefault(); openActions(tab); };
      strip.append(tab);
    },
    remove(tab) {
      const group = groupOf(tab);
      if (tab === selectedTab && tabDialog.open) tabDialog.close();
      tab.remove();
      removeEmpty(group);
      if (groupDialog.open && (editingGroup ? !editingGroup.isConnected : tab === selectedTab)) groupDialog.close();
      if (tab === selectedTab) selectedTab = null;
      if (dragged && !dragged.isConnected) { dragged = null; clearDrop(); }
    },
    order() { return [...strip.querySelectorAll('.tab')].map(tab => Number(tab.dataset.key)); }
  };
}
