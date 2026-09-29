// Only the legacy MCP's explicit ask({ options, controls, ... }) creates these
// controls. They belong to its generated document, never to the host layout.
export function legacyControls() {
  let current, panel;
  const make = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
  return request => {
    if (!request?.spec) { if (panel) for (const button of panel.querySelectorAll('button')) button.disabled = true; return; }
    if (current === request.id) return; current = request.id; panel?.remove();
    const spec = request.spec, defaults = { selected: [], text: '', fields: Object.fromEntries((spec.controls || []).map(c => [c.id, c.value ?? (c.type === 'checkbox' ? false : '')])) };
    const previous = window.webagent.state.__legacy;
    let value = previous?.requestId === request.id ? previous.value : defaults, sending = false;
    const persist = () => window.webagent.saveState({ ...window.webagent.state, __legacy: { requestId: request.id, value } }).catch(e => { status.textContent = e.message; });
    panel = make('section'); panel.className = 'web-agent-legacy-input'; panel.setAttribute('aria-label', spec.title || '请确认');
    const style = make('style'); style.textContent = '.web-agent-legacy-input{margin:24px 0;padding:20px;border:1px solid #d6dfd1;border-radius:8px;font:15px/1.8 system-ui}.web-agent-legacy-input label{display:block;margin:12px 0}.web-agent-legacy-input input,.web-agent-legacy-input select,.web-agent-legacy-input textarea,.web-agent-legacy-input button{font:inherit;max-width:100%}.web-agent-legacy-input textarea{display:block;width:100%;min-height:80px}.web-agent-legacy-input button{margin:12px 8px 0 0;padding:8px 16px;cursor:pointer}.web-agent-legacy-input small{display:block;opacity:.7}'; panel.append(style);
    if (spec.title) panel.append(make('h3', spec.title));
    for (const [index, option] of (spec.options || []).entries()) {
      const id = String(option.id ?? index), label = make('label'), input = make('input'); input.type = spec.multiSelect ? 'checkbox' : 'radio'; input.name = request.id; input.checked = value.selected.includes(id);
      input.onchange = () => { value.selected = spec.multiSelect ? input.checked ? [...value.selected, id] : value.selected.filter(v => v !== id) : [id]; persist(); };
      label.append(input, document.createTextNode(` ${option.label || id}`)); if (option.description) label.append(make('small', option.description)); panel.append(label);
    }
    for (const control of spec.controls || []) {
      const label = make('label', control.label || control.id), input = make(control.type === 'select' ? 'select' : 'input');
      if (control.type === 'select') for (const option of control.options || []) { const el = make('option', option.label ?? option.value ?? option); el.value = option.value ?? option; input.append(el); }
      else input.type = control.type === 'slider' ? 'range' : control.type;
      for (const key of ['min', 'max', 'step', 'placeholder']) if (control[key] !== undefined) input.setAttribute(key, control[key]);
      input.value = value.fields[control.id] ?? ''; if (control.type === 'checkbox') input.checked = !!value.fields[control.id];
      input.oninput = () => { value.fields[control.id] = control.type === 'checkbox' ? input.checked : ['slider', 'number'].includes(control.type) ? input.valueAsNumber : input.value; persist(); };
      label.append(input); panel.append(label);
    }
    if (spec.freeText?.enabled) {
      const input = make('textarea'); input.setAttribute('aria-label', '补充意见'); input.placeholder = spec.freeText.placeholder || '补充意见'; input.value = value.text;
      input.oninput = () => { value.text = input.value; persist(); }; panel.append(input);
    }
    const status = make('p'); status.setAttribute('role', 'status');
    const actions = spec.actions?.length ? spec.actions : [{ label: spec.submitLabel || '提交回答' }];
    for (const action of actions) {
      const button = make('button', action.label || action.id); button.type = 'button';
      button.onclick = async () => {
        if (sending) return; sending = true; button.disabled = true;
        try { await window.webagent.submit({ ...value, ...(action.id ? { action: action.id } : {}), selectedLabels: (spec.options || []).filter((o, i) => value.selected.includes(String(o.id ?? i))).map(o => o.label) }); status.textContent = '已提交'; }
        catch (error) { status.textContent = error.message; button.disabled = false; } finally { sending = false; }
      }; panel.append(button);
    }
    panel.append(status); document.body.append(panel);
  };
}
