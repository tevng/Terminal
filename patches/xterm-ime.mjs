import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Build the pinned upstream sources, keeping this small compatibility patch readable
// instead of altering a minified dependency in node_modules.
// Upstream issue: https://github.com/xtermjs/xterm.js/issues/6049
// Proposed upstream fix: https://github.com/xtermjs/xterm.js/pull/6051
// Input/diff ownership: https://github.com/xtermjs/xterm.js/issues/6045
export function xtermImePlugin(){
  const root=path.dirname(require.resolve('@xterm/xterm/package.json'));
  const sourceRoot=path.join(root,'src');
  const replaceOnce=(source,before,after)=>{
    if(source.split(before).length!==2)throw Error('xterm IME patch no longer matches the pinned upstream source');
    return source.replace(before,after);
  };
  return {name:'xterm-ime-compatibility',setup(build){
    build.onResolve({filter:/^@xterm\/xterm$/},()=>({path:path.join(sourceRoot,'browser/public/Terminal.ts')}));
    build.onResolve({filter:/^(browser|common|vs)\//},args=>({path:path.join(sourceRoot,args.path+'.ts')}));
    build.onLoad({filter:/[\\/]CompositionHelper\.ts$/},async args=>{
      const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
      if(pkg.version!=='6.0.0')throw Error('Review the IME patch before upgrading xterm.js');
      let source=(await readFile(args.path,'utf8')).replace(/\r\n/g,'\n');
      source=replaceOnce(source,'private _dataAlreadySent: string;','private _dataAlreadySent: string;\n  private _inputEventGeneration = 0;\n  private _pendingCommittedData: string | undefined;\n  public get isSendingComposition(): boolean { return this._isSendingComposition; }\n  public get pendingCommittedData(): string | undefined { return this._pendingCommittedData; }\n  public noteInputEvent(): void { this._inputEventGeneration++; }\n  public flushPendingCommit(): void {\n    if (!this._isComposing && this._isSendingComposition && this._pendingCommittedData !== undefined) {\n      const data = this._pendingCommittedData;\n      this._pendingCommittedData = undefined;\n      this._isSendingComposition = false;\n      if (data) this._coreService.triggerDataEvent(data, true);\n    }\n  }');
      source=replaceOnce(source,'public keydown(ev: KeyboardEvent): boolean {','public keydown(ev: KeyboardEvent): boolean {\n    this.flushPendingCommit();');
      source=replaceOnce(source,'public compositionstart(): void {','public compositionstart(): void {\n    this.noteInputEvent();');
      source=replaceOnce(source,'public compositionend(): void {\n    this._finalizeComposition(true);','public compositionend(event?: CompositionEvent): void {\n    this._finalizeComposition(true, event?.data);');
      source=replaceOnce(source,'public compositionend(event?: CompositionEvent): void {','public compositionend(event?: CompositionEvent): void {\n    this.noteInputEvent();');
      source=replaceOnce(source,'private _finalizeComposition(waitForPropagation: boolean): void {','private _finalizeComposition(waitForPropagation: boolean, committedData?: string): void {');
      source=replaceOnce(source,'this._isSendingComposition = true;','this._pendingCommittedData = committedData;\n      this._isSendingComposition = true;');
      source=replaceOnce(source,'if (this._isComposing) {\n            // Use the start position','if (committedData !== undefined) {\n            // TSF can replace the whole textarea, invalidating the saved start offset.\n            // Empty data is an explicit cancellation; keep the legacy fallback for\n            // keydown-driven finalization where no compositionend event exists.\n            input = committedData;\n          } else if (this._isComposing) {\n            // Use the start position');
      source=replaceOnce(source,'const oldValue = this._textarea.value;','const inputGeneration = this._inputEventGeneration;\n    const oldValue = this._textarea.value;');
      source=replaceOnce(source,'if (!this._isComposing) {\n        const newValue','if (!this._isComposing && !this._isSendingComposition && inputGeneration === this._inputEventGeneration) {\n        // Native input events own their insertion. The legacy textarea-diff\n        // fallback must not re-send an insertion already handled by input.\n        const newValue');
      return {contents:source,loader:'ts'};
    });
    build.onLoad({filter:/[\\/]CoreBrowserTerminal\.ts$/},async args=>{
      let source=(await readFile(args.path,'utf8')).replace(/\r\n/g,'\n');
      source=replaceOnce(source,"'compositionend', () => this._compositionHelper!.compositionend()","'compositionend', (event: CompositionEvent) => this._compositionHelper!.compositionend(event)");
      source=replaceOnce(source,'protected _inputEvent(ev: InputEvent): boolean {','protected _inputEvent(ev: InputEvent): boolean {\n    if (ev.inputType === "insertText" || ev.inputType === "insertCompositionText") {\n      this._compositionHelper!.noteInputEvent();\n    }\n    if (ev.inputType === "insertText" && !ev.isComposing && ev.data !== this._compositionHelper!.pendingCommittedData) {\n      this._compositionHelper!.flushPendingCommit();\n    }');
      source=replaceOnce(source,"if (ev.data && ev.inputType === 'insertText' && (!ev.composed || !this._keyDownSeen) && !this.optionsService.rawOptions.screenReaderMode) {","if (ev.data && ev.inputType === 'insertText' && !ev.isComposing && !this._compositionHelper!.isComposing && !this._compositionHelper!.isSendingComposition && !this.optionsService.rawOptions.screenReaderMode) {");
      source=replaceOnce(source,'protected _keyPress(ev: KeyboardEvent): boolean {\n    let key;','protected _keyPress(ev: KeyboardEvent): boolean {\n    if (this._compositionHelper!.isComposing || this._compositionHelper!.isSendingComposition) return false;\n    let key;');
      return {contents:source,loader:'ts'};
    });
  }};
}
