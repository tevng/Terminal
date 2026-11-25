const assert = require('node:assert/strict');

async function checkWorkspace(page, channels, channelInput, channelSize, screenshot) {
  const tab = name => page.getByRole('tab', { name, exact: true });
  const tabNames = () => page.locator('.tab-label').allTextContents();
  const activeTab = () => page.locator('.tab.active .tab-label').innerText();
  const pane = async name => page.locator('#' + await tab(name).getAttribute('aria-controls'));
  const visiblePanes = page.locator('#panes > .terminal-host:not([hidden])');
  const chooseTabActions = name => tab(name).locator('..').locator('.tab-actions').click();
  const dragBefore = (from, to) => from.dragTo(to, { targetPosition: { x: 3, y: 10 } });

  await dragBefore(tab('Session 4'), tab('Development server'));
  assert.deepEqual((await tabNames()).slice(0, 3), ['Session 4', 'Development server', 'Session 2']);
  await tab('Session 4').click();
  await page.keyboard.press('Control+Tab');
  assert.equal(await activeTab(), 'Development server', 'Ctrl+Tab follows the displayed order');

  await tab('Development server').click({ button: 'right' });
  await page.locator('#tab-group-new').click();
  await page.locator('#group-name').fill('Operations');
  await page.locator('#group-save').click();
  const group = page.locator('.tab-group');
  assert.deepEqual(await group.locator('.tab-label').allTextContents(), ['Development server']);
  await chooseTabActions('Session 2');
  await page.locator('#tab-group-select').selectOption({ label: 'Operations' });
  assert.deepEqual(await group.locator('.tab-label').allTextContents(), ['Development server', 'Session 2']);
  await group.locator('.tab-group-label').click();
  await page.locator('#group-name').fill('Servers');
  await page.locator('#group-save').click();
  await dragBefore(group.locator('.tab-group-label'), tab('Session 4'));
  assert.deepEqual((await tabNames()).slice(0, 3), ['Development server', 'Session 2', 'Session 4']);
  await chooseTabActions('Development server');
  await page.locator('#tab-group-select').selectOption('');
  assert.deepEqual(await group.locator('.tab-label').allTextContents(), ['Session 2']);
  await group.locator('.tab-group-label').click();
  await page.locator('#group-ungroup').click();
  assert.equal(await group.count(), 0);
  assert.equal(channels.length, 5, 'reordering and grouping keep SSH sessions open');

  async function openSplit(names, direction = 'columns') {
    await page.locator('#split-open').click();
    const choices = page.locator('#split-tabs');
    for (const checkbox of await choices.getByRole('checkbox').all()) await checkbox.uncheck();
    assert.equal(await page.locator('#split-apply').isDisabled(), true);
    for (const name of names) await choices.getByRole('checkbox', { name, exact: true }).check();
    await page.locator('#split-direction').selectOption(direction);
    await page.locator('#split-apply').click();
    assert.equal(await visiblePanes.count(), names.length);
  }

  async function waitForSize(channel, test, message) {
    for (let i = 0; i < 100; i++) {
      if (test(channelSize.get(channel))) return;
      await page.waitForTimeout(20);
    }
    assert.fail(message);
  }

  await tab('Development server').click();
  const originalWidth = (await (await pane('Development server')).boundingBox()).width;
  const originalCols = channelSize.get(channels[0]).cols;
  await openSplit(['Development server', 'Session 2', 'Session 3']);
  const firstPane = await pane('Session 2');
  const secondPane = await pane('Development server');
  const first = await firstPane.boundingBox(), second = await secondPane.boundingBox();
  assert.ok(first.x < second.x && second.width < originalWidth, 'side-by-side panes share the workspace');
  await waitForSize(channels[0], size => size.cols < originalCols, 'SSH receives the smaller split width');
  await waitForSize(channels[1], size => size.cols < originalCols, 'the neighboring SSH pane is resized too');

  const divider = page.locator('.pane-divider').first();
  const handle = await divider.boundingBox();
  const firstCols = channelSize.get(channels[1]).cols;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 85, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  assert.ok(Math.abs((await firstPane.boundingBox()).width - first.width) < 2, 'dragging back restores the original ratio');
  await page.mouse.move(handle.x + handle.width / 2 + 85, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.ok((await firstPane.boundingBox()).width > first.width + 35, 'dragging the divider grows the neighboring pane');
  assert.ok((await secondPane.boundingBox()).width < second.width - 35, 'dragging the divider shrinks the other pane');
  await waitForSize(channels[1], size => size.cols > firstCols, 'SSH receives the resized pane width');
  await page.screenshot({ path: screenshot });

  await firstPane.locator('.xterm-screen').click({ position: { x: 6, y: 6 } });
  assert.equal(await activeTab(), 'Session 2');
  await page.keyboard.type('PANE_INPUT');
  for (let i = 0; i < 100 && !channelInput.get(channels[1]).includes('PANE_INPUT'); i++) await page.waitForTimeout(20);
  assert.ok(channelInput.get(channels[1]).includes('PANE_INPUT'), 'input reaches the focused SSH pane');
  assert.ok(!channelInput.get(channels[0]).includes('PANE_INPUT'), 'the other pane receives no input');
  await tab('Session 4').click();
  assert.equal(await (await pane('Session 2')).isVisible(), false);
  assert.equal(await (await pane('Session 4')).isVisible(), true);
  assert.equal(await visiblePanes.count(), 3);

  await openSplit(['Development server', 'Session 3', 'Session 4'], 'rows');
  const topPane = await pane('Session 4'), top = await topPane.boundingBox();
  assert.ok(top.y < (await secondPane.boundingBox()).y);
  await page.locator('.pane-divider').first().press('ArrowDown');
  assert.ok((await topPane.boundingBox()).height > top.height + 10, 'keyboard resizing adjusts stacked panes');
  await page.locator('#split-open').click();
  await page.locator('#split-end').click();
  assert.equal(await visiblePanes.count(), 1);
  assert.equal(await activeTab(), 'Session 4');

  await openSplit(['Development server', 'Session 3', 'Session 4']);
}

module.exports = { checkWorkspace };
