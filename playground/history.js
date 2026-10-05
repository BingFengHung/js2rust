(() => {
const CURRENT = 'js2rust_saved_project';
const BACKUP = 'js2rust_saved_project_backup';
const SNAPSHOTS = 'js2rust_project_snapshots';
const MAX_BYTES = 2_000_000;
function validProject(project) {
  if (!project || typeof project !== 'object' || !project.files || Array.isArray(project.files)) return false;
  const entries = Object.entries(project.files);
  return entries.length > 0 && entries.length <= 200 && entries.every(([name, source]) => typeof source === 'string' && name.length <= 200 && !name.includes('\0') && !name.split('/').includes('..')) && (project.folders === undefined || Array.isArray(project.folders) && project.folders.every(f => typeof f === 'string')) && JSON.stringify(project).length <= MAX_BYTES;
}
const fingerprint = p => JSON.stringify([Object.entries(p.files).sort(([a], [b]) => a.localeCompare(b)), [...(p.folders || [])].sort()]);
class ProjectHistory {
  static valid(project) { return validProject(project); }
  constructor(storage, { maxSnapshots = 20, now = () => Date.now() } = {}) { this.storage = storage; this.maxSnapshots = maxSnapshots; this.now = now; }
  read(key) { try { return JSON.parse(this.storage.getItem(key)); } catch { return null; } }
  load() {
    const current = this.read(CURRENT), backup = this.read(BACKUP);
    if (validProject(current)) return { project: current, recovered: false };
    if (validProject(backup)) return { project: backup, recovered: true };
    return null;
  }
  save(project) {
    if (!validProject(project)) throw new Error('專案過大或內容格式不符，請匯出備份。');
    const previous = this.read(CURRENT);
    if (validProject(previous)) this.storage.setItem(BACKUP, JSON.stringify(previous));
    this.storage.setItem(CURRENT, JSON.stringify({ version: 2, ...project, savedAt: this.now() }));
  }
  list() {
    const values = this.read(SNAPSHOTS);
    return Array.isArray(values) ? values.filter(s => typeof s.id === 'string' && validProject(s.project)).slice(-this.maxSnapshots).reverse() : [];
  }
  snapshot(project, name = '自動快照', { renameExisting = false } = {}) {
    if (!validProject(project)) throw new Error('無法儲存此快照，請匯出專案備份。');
    const snapshots = this.list().reverse();
    if (snapshots.length && fingerprint(snapshots.at(-1).project) === fingerprint(project)) {
      if (renameExisting) { snapshots.at(-1).name = String(name).slice(0, 80); this.storage.setItem(SNAPSHOTS, JSON.stringify(snapshots)); }
      return snapshots.at(-1).id;
    }
    const time = this.now(), id = `${time}-${Math.random().toString(36).slice(2, 9)}`;
    snapshots.push({ id, name: String(name).slice(0, 80), createdAt: time, project: JSON.parse(JSON.stringify(project)) });
    while (snapshots.length > this.maxSnapshots || snapshots.length > 1 && JSON.stringify(snapshots).length > MAX_BYTES) snapshots.shift();
    this.storage.setItem(SNAPSHOTS, JSON.stringify(snapshots));
    return id;
  }
  restore(id, current) {
    const snapshot = this.list().find(s => s.id === id);
    if (!snapshot) throw new Error('找不到此快照。');
    this.snapshot(current, '還原前的版本');
    this.save(snapshot.project);
    return JSON.parse(JSON.stringify(snapshot.project));
  }
  diff(id, current) {
    const old = this.list().find(s => s.id === id)?.project;
    if (!old) return [];
    return [...new Set([...Object.keys(old.files), ...Object.keys(current.files)])].sort().filter(f => old.files[f] !== current.files[f]).map(filename => ({ filename, before: old.files[filename], after: current.files[filename], status: !(filename in old.files) ? '新增' : !(filename in current.files) ? '刪除' : '修改' }));
  }
}

globalThis.JS2RUST_HISTORY = { ProjectHistory };
})();
