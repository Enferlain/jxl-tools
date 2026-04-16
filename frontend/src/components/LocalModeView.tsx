import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus, FolderPlus, Folder, FolderOutput, LogOut, Settings, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { inspectSelection, pickSourceFiles, pickSourceFolder, pickTargetFolder } from '../api';
import { ConversionSettingsPanel } from './ConversionSettingsPanel';
import { Button, Checkbox, Toggle } from './UI';
import { useAppStore } from '../store/useAppStore';
import { TreeNode } from './TreeNode';
import type { FileNode, InspectGroup, InspectSelectionResponse } from '../types';
import { formatBytes } from '../utils/formatBytes';

interface Props {
  startConversion: () => void;
}

const EXTENSION_COLORS = ['#5E6AD2', '#00E676', '#FFB020', '#4DD2FF', '#F87171', '#A78BFA', '#34D399'];
const MIN_LEFT_WIDTH = 200;
const MAX_LEFT_WIDTH = 800;
const MIN_MIDDLE_WIDTH = 250;
const MAX_MIDDLE_WIDTH = 800;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function getDefaultPaneWidths(totalWidth: number): { leftWidth: number; middleWidth: number } {
  const usableWidth = Math.max(0, totalWidth - 2);
  const leftWidth = clamp(Math.round((usableWidth * 4) / 9), MIN_LEFT_WIDTH, MAX_LEFT_WIDTH);
  const middleWidth = clamp(Math.round((usableWidth * 2) / 9), MIN_MIDDLE_WIDTH, MAX_MIDDLE_WIDTH);

  return { leftWidth, middleWidth };
}

function createFolderNode(name: string, path: string): FileNode {
  return {
    name,
    label: name,
    path,
    type: 'folder',
    size: 0,
    files: 0,
    folders: 0,
    expanded: true,
    children: [],
  };
}

function getSiblingOutputDir(paths: string[]): string {
  const source = paths[0] ?? '';
  if (!source) return '';
  const normalized = source.replace(/\\/g, '/');
  const base = normalized.includes('.') ? normalized.split('/').slice(0, -1).join('/') : normalized;
  const parts = base.split('/').filter(Boolean);
  if (parts.length === 0) return `${base}_jxl`;
  const leaf = parts.at(-1) ?? 'output';
  const parent = base.slice(0, base.length - leaf.length).replace(/\/$/, '');
  return `${parent}/${leaf}_jxl`;
}

function buildTreeForGroup(group: InspectGroup): FileNode {
  const root = createFolderNode(group.folder_name, group.folder_path);
  root.label = group.folder_path;
  const folderIndex = new Map<string, FileNode>([['.', root]]);

  for (const file of group.files) {
    const parts = file.relative_path.split(/[\\/]/).filter(Boolean);
    const fileName = parts.pop() ?? file.name;
    let currentPath = '.';
    let parent = root;

    for (const part of parts) {
      const nextPath = currentPath === '.' ? part : `${currentPath}/${part}`;
      let folder = folderIndex.get(nextPath);
      if (!folder) {
        folder = createFolderNode(part, `${group.folder_path}/${nextPath}`);
        parent.children?.push(folder);
        folderIndex.set(nextPath, folder);
      }
      parent = folder;
      currentPath = nextPath;
    }

    parent.children?.push({
      name: fileName,
      path: file.path,
      type: 'file',
      size: file.size,
      extension: file.extension,
    });
  }

  const finalize = (node: FileNode): { size: number; files: number; folders: number } => {
    if (node.type === 'file') {
      return { size: node.size ?? 0, files: 0, folders: 0 };
    }

    let size = 0;
    let files = 0;
    let folders = 0;

    node.children = [...(node.children ?? [])].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of node.children) {
      const totals = finalize(child);
      size += totals.size;
      if (child.type === 'file') {
        files += 1;
      } else {
        folders += 1 + totals.folders;
        files += totals.files;
      }
    }

    node.size = size;
    node.files = files;
    node.folders = folders;
    return { size, files, folders };
  };

  finalize(root);
  return root;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isSameOrDescendantPath(path: string, targetPath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedTarget = normalizePath(targetPath);

  return normalizedPath === normalizedTarget || normalizedPath.startsWith(`${normalizedTarget}/`);
}

function buildSelectionPathsAfterRemoval(
  inspection: InspectSelectionResponse,
  removedPath: string,
): string[] {
  const nextPaths: string[] = [];

  for (const group of inspection.groups) {
    if (isSameOrDescendantPath(group.folder_path, removedPath)) {
      continue;
    }

    for (const file of group.files) {
      if (!isSameOrDescendantPath(file.path, removedPath)) {
        nextPaths.push(file.path);
      }
    }
  }

  return Array.from(new Set(nextPaths));
}

export function LocalModeView({ startConversion }: Props) {
  const {
    settings,
    updateSettings,
    localSelectedPaths,
    localInspection,
    setLocalSelection,
    outputDir,
    setOutputDir,
  } = useAppStore();
  const workbenchRef = useRef<HTMLElement | null>(null);
  const [siblingTarget, setSiblingTarget] = useState(false);
  const [leftWidth, setLeftWidth] = useState(520);
  const [middleWidth, setMiddleWidth] = useState(260);
  const [isBusy, setIsBusy] = useState(false);

  const selectionTree = useMemo(
    () => localInspection?.groups.map(buildTreeForGroup) ?? [],
    [localInspection],
  );

  const totalSize = localInspection?.totals.total_size ?? 0;
  const totalFiles = localInspection?.totals.file_count ?? 0;
  const selectedFolders = localInspection?.groups.length ?? 0;

  useEffect(() => {
    if (!siblingTarget || localSelectedPaths.length === 0) return;
    setOutputDir(getSiblingOutputDir(localSelectedPaths));
  }, [localSelectedPaths, siblingTarget, setOutputDir]);

  useEffect(() => {
    const width = workbenchRef.current?.clientWidth;
    if (!width) return;

    const defaults = getDefaultPaneWidths(width);
    setLeftWidth(defaults.leftWidth);
    setMiddleWidth(defaults.middleWidth);
  }, []);

  const startResizingLeft = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    const startX = mouseDownEvent.clientX;
    const startLeftWidth = leftWidth;
    const startMiddleWidth = middleWidth;

    const onMouseMove = (mouseMoveEvent: MouseEvent) => {
      let delta = mouseMoveEvent.clientX - startX;
      const maxDeltaLeft = MAX_LEFT_WIDTH - startLeftWidth;
      const minDeltaLeft = MIN_LEFT_WIDTH - startLeftWidth;
      const maxDeltaMiddle = startMiddleWidth - MIN_MIDDLE_WIDTH;
      const minDeltaMiddle = startMiddleWidth - MAX_MIDDLE_WIDTH;
      const maxDelta = Math.min(maxDeltaLeft, maxDeltaMiddle);
      const minDelta = Math.max(minDeltaLeft, minDeltaMiddle);
      delta = Math.max(minDelta, Math.min(delta, maxDelta));
      setLeftWidth(startLeftWidth + delta);
      setMiddleWidth(startMiddleWidth - delta);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const startResizingMiddle = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    const startX = mouseDownEvent.clientX;
    const startWidth = middleWidth;

    const onMouseMove = (mouseMoveEvent: MouseEvent) => {
      const newWidth = startWidth + (mouseMoveEvent.clientX - startX);
      setMiddleWidth(clamp(newWidth, MIN_MIDDLE_WIDTH, MAX_MIDDLE_WIDTH));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const applySelection = (paths: string[], inspection: InspectSelectionResponse | null) => {
    setLocalSelection(paths, inspection);
    if (siblingTarget && paths.length > 0) {
      setOutputDir(getSiblingOutputDir(paths));
    }
  };

  const handlePickFiles = async () => {
    setIsBusy(true);
    try {
      const response = await pickSourceFiles(settings.recursive);
      if (!response.cancelled && response.picked_paths && response.groups && response.totals && response.extensions) {
        applySelection(response.picked_paths, {
          groups: response.groups,
          totals: response.totals,
          extensions: response.extensions,
          recursive: settings.recursive,
        });
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to pick files.');
    } finally {
      setIsBusy(false);
    }
  };

  const handlePickFolder = async () => {
    setIsBusy(true);
    try {
      const response = await pickSourceFolder(settings.recursive);
      if (!response.cancelled && response.picked_paths && response.groups && response.totals && response.extensions) {
        applySelection(response.picked_paths, {
          groups: response.groups,
          totals: response.totals,
          extensions: response.extensions,
          recursive: settings.recursive,
        });
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to pick folder.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRefreshInspection = async (recursive: boolean) => {
    if (localSelectedPaths.length === 0) return;
    setIsBusy(true);
    try {
      const inspection = await inspectSelection(localSelectedPaths, recursive);
      setLocalSelection(localSelectedPaths, inspection);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to refresh selection.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRecursiveChange = (value: boolean) => {
    updateSettings({ recursive: value });
    void handleRefreshInspection(value);
  };

  const handleRemoveSelectionPath = async (path: string) => {
    if (!localInspection) return;

    const nextPaths = buildSelectionPathsAfterRemoval(localInspection, path);
    if (nextPaths.length === 0) {
      setLocalSelection([], null);
      if (siblingTarget) {
        setOutputDir('');
      }
      return;
    }

    setIsBusy(true);
    try {
      const inspection = await inspectSelection(nextPaths, settings.recursive);
      applySelection(nextPaths, inspection);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to remove item from selection.');
    } finally {
      setIsBusy(false);
    }
  };

  const handlePickTarget = async () => {
    setIsBusy(true);
    try {
      const response = await pickTargetFolder();
      if (!response.cancelled && response.path) {
        setSiblingTarget(false);
        setOutputDir(response.path);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to pick target folder.');
    } finally {
      setIsBusy(false);
    }
  };

  let savingsPercent = 0;
  let estimatedSize = totalSize;
  let isSaving = true;

  if (settings.direction === 'to_jxl') {
    savingsPercent = settings.lossless ? 20 : Math.max(0, 100 - settings.quality + 10);
    estimatedSize = totalSize * (1 - savingsPercent / 100);
  } else {
    savingsPercent = 45;
    estimatedSize = totalSize * (1 + savingsPercent / 100);
    isSaving = false;
  }

  return (
    <>
      <div className="flex-none h-14 border-b border-white/[0.06] bg-[#0a0a0c] flex items-center justify-between px-6 z-10 relative shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3 text-[#EDEDEF] font-semibold tracking-widest text-xs uppercase">
            <SlidersHorizontal size={16} className="text-[#5E6AD2]" />
            Input Rules
          </div>
          <div className="flex items-center gap-6">
            <Toggle label="Recursive" checked={settings.recursive} onChange={handleRecursiveChange} />
            <div className="text-xs text-[#8A8F98] font-mono">
              {selectedFolders} group{selectedFolders === 1 ? '' : 's'} selected • {totalFiles} file{totalFiles === 1 ? '' : 's'} • {formatBytes(totalSize)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" icon={<FilePlus size={14} />} onClick={handlePickFiles}>Pick Files</Button>
          <Button variant="secondary" icon={<FolderPlus size={14} />} onClick={handlePickFolder}>Pick Folder</Button>
        </div>
      </div>

      <main ref={workbenchRef} className="flex-1 flex min-h-0 relative z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#5E6AD2]/5 blur-[120px] pointer-events-none rounded-full" />

        <div className="flex-none flex flex-col min-w-0 bg-[#050506]/80 backdrop-blur-sm" style={{ width: leftWidth }}>
          <div
            className="flex-none h-12 border-b border-white/[0.06] bg-[#0a0a0c]/50 grid grid-cols-[minmax(0,1fr)_5rem_4rem_4rem] items-center pl-6 text-[10px] font-mono tracking-wider text-[#8A8F98] uppercase"
            style={{ paddingRight: 'calc(1.5rem + var(--tree-scrollbar-gutter))' }}
          >
            <div>Name</div>
            <div className="justify-self-end text-right">Size</div>
            <div className="justify-self-end text-right">Files</div>
            <div className="justify-self-end text-right">Folders</div>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar scrollbar-gutter-stable pb-2">
            {selectionTree.length > 0 ? (
              selectionTree.map((node) => (
                <div key={node.path}>
                  <TreeNode
                    node={node}
                    recursive={settings.recursive}
                    disabled={isBusy}
                    onRemove={handleRemoveSelectionPath}
                  />
                </div>
              ))
            ) : (
              <div className="p-6 text-sm text-[#8A8F98]">
                Pick files or folders to build the local selection tree.
              </div>
            )}
          </div>
        </div>

        <div className="relative w-[1px] bg-white/[0.06] z-20 flex-none group">
          <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize z-30" onMouseDown={startResizingLeft} />
          <div className="absolute inset-y-0 left-0 w-[1px] bg-transparent group-hover:bg-[#5E6AD2] transition-colors pointer-events-none" />
        </div>

        <div className="flex-none flex flex-col bg-[#0a0a0c]/80 backdrop-blur-sm z-10" style={{ width: middleWidth }}>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-none h-12 border-b border-white/[0.06] bg-[#0a0a0c]/50 flex items-center px-6 text-[10px] font-mono tracking-wider text-[#8A8F98] uppercase">
              <div className="flex-1">Extension</div>
              <div className="w-24 text-right">%</div>
              <div className="w-20 text-right">Size</div>
              <div className="w-16 text-right">Count</div>
            </div>
            <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
              <div className="flex flex-col gap-4">
                {(localInspection?.extensions ?? []).map((ext, i) => {
                  const color = EXTENSION_COLORS[i % EXTENSION_COLORS.length];
                  return (
                    <div key={ext.extension} className="flex items-center text-xs font-mono">
                      <div className="flex-1 flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: color, color }} />
                        <span className="text-[#EDEDEF] font-bold">.{ext.extension}</span>
                      </div>
                      <div className="w-24 flex items-center gap-3 justify-end">
                        <div className="w-8 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, ext.percent)}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-[#8A8F98] w-10 text-right">{ext.percent.toFixed(1)}%</span>
                      </div>
                      <div className="w-20 text-right text-[#8A8F98]">{formatBytes(ext.size)}</div>
                      <div className="w-16 text-right text-[#8A8F98]">{ext.count}</div>
                    </div>
                  );
                })}
                {!localInspection && (
                  <div className="text-sm text-[#8A8F98]">
                    Dataset breakdown appears here after you choose a local selection.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-white/[0.06] bg-[#050506]/80 flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#050506] border border-white/[0.04] rounded-xl p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
                <div className="text-[10px] text-[#8A8F98] mb-1 uppercase tracking-wider font-mono">Total Files</div>
                <div className="text-2xl font-semibold tracking-tight text-[#EDEDEF]">{totalFiles.toLocaleString()}</div>
              </div>
              <div className="bg-[#050506] border border-white/[0.04] rounded-xl p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
                <div className="text-[10px] text-[#8A8F98] mb-1 uppercase tracking-wider font-mono">Current Size</div>
                <div className="text-2xl font-semibold tracking-tight text-[#EDEDEF]">{formatBytes(totalSize)}</div>
              </div>
            </div>

            <div className={`bg-[#0a0a0c] border rounded-xl p-4 relative overflow-hidden transition-colors duration-500 ${isSaving ? 'border-[#5E6AD2]/20 shadow-[inset_0_1px_0_0_rgba(94,106,210,0.1),0_4px_20px_rgba(94,106,210,0.05)]' : 'border-[#FF4D4D]/20 shadow-[inset_0_1px_0_0_rgba(255,77,77,0.1),0_4px_20px_rgba(255,77,77,0.05)]'}`}>
              <div className={`absolute top-0 right-0 w-32 h-32 blur-2xl rounded-full -mr-10 -mt-10 pointer-events-none transition-colors duration-500 ${isSaving ? 'bg-[#5E6AD2]/10' : 'bg-[#FF4D4D]/10'}`} />

              <div className="flex items-center justify-between mb-3 relative z-10">
                <div className={`flex items-center gap-2 text-[10px] font-mono tracking-wider uppercase font-semibold transition-colors duration-500 ${isSaving ? 'text-[#5E6AD2]' : 'text-[#FF4D4D]'}`}>
                  <TrendingUp size={14} />
                  Estimated Output
                </div>
                <div className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors duration-500 ${isSaving ? 'text-[#00E676] bg-[#00E676]/10 border-[#00E676]/20' : 'text-[#FF4D4D] bg-[#FF4D4D]/10 border-[#FF4D4D]/20'}`}>
                  {isSaving ? '-' : '+'}{savingsPercent.toFixed(0)}%
                </div>
              </div>

              <div className="text-3xl font-semibold tracking-tight text-[#EDEDEF] mb-4 relative z-10">
                {formatBytes(estimatedSize)}
              </div>

              <div className="relative z-10">
                <div className="flex justify-between text-[10px] text-[#8A8F98] mb-1.5 font-mono">
                  <span>{formatBytes(0)}</span>
                  <span>{formatBytes(Math.max(totalSize, estimatedSize))}</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden flex">
                  {isSaving ? (
                    <>
                      <div className="h-full bg-[#5E6AD2] transition-all duration-500" style={{ width: `${100 - savingsPercent}%` }} />
                      <div className="h-full bg-[#00E676] transition-all duration-500" style={{ width: `${savingsPercent}%` }} />
                    </>
                  ) : (
                    <>
                      <div className="h-full bg-[#5E6AD2] transition-all duration-500" style={{ width: `${estimatedSize > 0 ? (totalSize / estimatedSize) * 100 : 0}%` }} />
                      <div className="h-full bg-[#FF4D4D] transition-all duration-500" style={{ width: `${estimatedSize > 0 ? (1 - totalSize / estimatedSize) * 100 : 0}%` }} />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative w-[1px] bg-white/[0.06] z-20 flex-none group">
          <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize z-30" onMouseDown={startResizingMiddle} />
          <div className="absolute inset-y-0 left-0 w-[1px] bg-transparent group-hover:bg-[#5E6AD2] transition-colors pointer-events-none" />
        </div>

        <div className="flex-1 flex flex-col bg-[#050506]/80 backdrop-blur-sm z-10 min-w-0">
          <div className="flex-none h-12 border-b border-white/[0.06] bg-[#0a0a0c]/50 flex items-center px-6 text-[10px] font-mono tracking-wider text-[#8A8F98] uppercase gap-2">
            <Settings size={14} />
            <div className="flex-1">Conversion Settings</div>
          </div>
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
            <ConversionSettingsPanel layout="grid" />
          </div>
        </div>
      </main>

      <div className="flex-none h-16 border-t border-white/[0.06] bg-[#0a0a0c] flex items-center justify-between px-6 z-10 relative shadow-[0_-4px_20px_rgba(0,0,0,0.2)]">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3 text-[#EDEDEF] font-semibold tracking-widest text-xs uppercase">
            <LogOut size={16} className="text-[#5E6AD2]" />
            Output Rules
          </div>
          <div className="flex items-center gap-6">
            <Checkbox label="Mirror" checked={settings.mirrorStructure} onChange={(value) => updateSettings({ mirrorStructure: value })} />
            <Checkbox
              label="Sibling _jxl target"
              checked={siblingTarget}
              onChange={(value) => {
                setSiblingTarget(value);
                if (value && localSelectedPaths.length > 0) {
                  setOutputDir(getSiblingOutputDir(localSelectedPaths));
                }
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-[#050506] border border-white/10 rounded-lg px-3 py-1.5 w-[350px]">
            <FolderOutput size={14} className="text-[#5E6AD2]" />
            <span className="text-sm text-[#EDEDEF] flex-1 truncate font-mono">{outputDir || 'Choose an output folder'}</span>
            <button onClick={handlePickTarget} className="cursor-pointer">
              <Folder size={14} className="text-[#8A8F98] hover:text-[#EDEDEF] transition-colors" />
            </button>
          </div>
          <button
            disabled={isBusy || localSelectedPaths.length === 0 || outputDir.length === 0}
            onClick={startConversion}
            className="bg-[#5E6AD2] hover:bg-[#6872D9] text-white text-sm font-bold px-6 py-2 rounded-lg shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_12px_rgba(94,106,210,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)] transition-all active:scale-95 tracking-wide uppercase cursor-pointer disabled:bg-white/[0.05] disabled:text-[#8A8F98] disabled:shadow-none disabled:cursor-not-allowed"
          >
            Initiate Export
          </button>
        </div>
      </div>
    </>
  );
}
