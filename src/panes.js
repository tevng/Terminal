const minimum = { columns: 180, rows: 120 };
const gutter = 8;

export function installPanes(container, t, requestFit) {
  let elements = [], weights = [], direction = 'columns';
  let handles = [];

  function applyTracks() {
    const min = elements.length > 1 ? minimum[direction] : 0;
    const tracks = weights.map(weight => 'minmax(' + min + 'px, ' + weight + 'fr)').join(' ' + gutter + 'px ');
    container.style.gridTemplateColumns = direction === 'columns' ? tracks : 'minmax(0, 1fr)';
    container.style.gridTemplateRows = direction === 'rows' ? tracks : 'minmax(0, 1fr)';
    handles.forEach((handle, index) => {
      const percent = Math.round(100 * weights[index] / (weights[index] + weights[index + 1]));
      handle.setAttribute('aria-valuenow', String(percent));
    });
  }

  function sizes() {
    const dimension = direction === 'columns' ? 'width' : 'height';
    return elements.map(element => element.getBoundingClientRect()[dimension]);
  }

  function resize(index, initial, delta) {
    const min = minimum[direction];
    const pair = initial[index] + initial[index + 1];
    const first = Math.max(min, Math.min(pair - min, initial[index] + delta));
    weights = [...initial];
    weights[index] = first;
    weights[index + 1] = pair - first;
    applyTracks();
    requestFit();
  }

  function position(node, track) {
    node.style.gridColumn = direction === 'columns' ? String(track) : '1';
    node.style.gridRow = direction === 'rows' ? String(track) : '1';
  }

  function createHandle(index) {
    const handle = document.createElement('div');
    const columns = direction === 'columns';
    const axis = columns ? 'clientX' : 'clientY';
    handle.className = 'pane-divider';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-controls', elements[index].id);
    handle.setAttribute('aria-orientation', columns ? 'vertical' : 'horizontal');
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', '100');
    handle.dataset.i18nLabel = handle.dataset.i18nTitle = 'split.resize';
    handle.title = t('split.resize'); handle.setAttribute('aria-label', handle.title);
    position(handle, index * 2 + 2);

    let drag;
    handle.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { id: event.pointerId, start: event[axis], initial: sizes() };
      handle.setPointerCapture(event.pointerId);
      container.classList.add('pane-resizing');
    };
    handle.onpointermove = event => {
      if (drag?.id === event.pointerId) resize(index, drag.initial, event[axis] - drag.start);
    };
    handle.onlostpointercapture = () => {
      drag = null;
      container.classList.remove('pane-resizing');
    };
    handle.onkeydown = event => {
      const decrease = columns ? 'ArrowLeft' : 'ArrowUp';
      const increase = columns ? 'ArrowRight' : 'ArrowDown';
      const step = event.shiftKey ? 64 : 24;
      const delta = { [decrease]: -step, [increase]: step, Home: -Infinity, End: Infinity }[event.key];
      if (typeof delta !== 'number') return;
      event.preventDefault();
      resize(index, sizes(), delta);
    };
    return handle;
  }

  return {
    show(next, axis = 'columns') {
      if (axis === direction && next.length === elements.length && next.every((element, index) => element === elements[index])) return false;

      const average = weights.length ? weights.reduce((sum, weight) => sum + weight, 0) / weights.length : 1;
      weights = next.map((element, index) => {
        if (axis !== direction || next.length <= 1 || elements.length <= 1) return 1;
        const previous = elements.indexOf(element);
        if (previous >= 0) return weights[previous];
        if (next.length === elements.length && !next.includes(elements[index])) return weights[index];
        return average;
      });
      elements = next;
      direction = axis;
      container.hidden = !next.length;
      container.dataset.direction = direction;
      container.classList.toggle('pane-split', next.length > 1);
      container.classList.remove('pane-resizing');

      for (const handle of handles) handle.remove();
      handles = [];
      elements.forEach((element, index) => {
        position(element, index * 2 + 1);
        if (index < elements.length - 1) {
          const handle = createHandle(index);
          handles.push(handle);
          container.append(handle);
        }
      });
      applyTracks();
      return true;
    }
  };
}
