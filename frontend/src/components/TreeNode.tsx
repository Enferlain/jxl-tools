import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Image as ImageIcon, X } from 'lucide-react';
import { FileNode } from '../types';
import { formatBytes } from '../utils/formatBytes';

interface TreeNodeProps {
  node: FileNode;
  depth?: number;
  recursive?: boolean;
  disabled?: boolean;
  onRemove?: (path: string) => void;
}

export function TreeNode({ node, depth = 0, recursive = true, disabled = false, onRemove }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(node.expanded || false);
  const isFolder = node.type === 'folder';
  const visibleChildren = node.children?.filter((child) => recursive || child.type === 'file');
  const hasVisibleChildren = visibleChildren && visibleChildren.length > 0;
  const label = node.label ?? node.name;

  return (
    <div>
      <div
        className="grid grid-cols-[minmax(0,1fr)_5rem_4rem_4rem] items-center px-6 py-2 hover:bg-white/[0.04] cursor-pointer group text-sm transition-colors border-b border-white/[0.02] last:border-0 relative"
        onClick={() => isFolder && setExpanded(!expanded)}
      >
        <div
          className="min-w-0 relative pr-4"
          style={{ paddingLeft: `${depth * 20 + 16}px` }}
        >
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${label} from selection`}
            title="Remove from selection"
            className="absolute top-1/2 -translate-y-1/2 left-0 w-4 h-4 flex items-center justify-center rounded text-[#8A8F98] opacity-0 group-hover:opacity-100 hover:text-[#FF8A8A] hover:bg-white/[0.05] transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            style={{ left: `${depth * 20 - 4}px` }}
            onClick={(event) => {
              event.stopPropagation();
              onRemove?.(node.path);
            }}
          >
            <X size={12} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-4 h-4 flex items-center justify-center text-[#8A8F98] group-hover:text-[#EDEDEF] transition-colors flex-none">
              {isFolder ? (
                (expanded && hasVisibleChildren) ? <ChevronDown size={14} /> : <ChevronRight size={14} />
              ) : (
                <span className="w-4" />
              )}
            </div>
            <div className={`${isFolder ? 'text-[#5E6AD2]' : 'text-[#8A8F98]'} flex-none`}>
              {isFolder ? <Folder size={14} className="fill-current opacity-20" /> : <ImageIcon size={14} />}
            </div>
            <span
              className={`truncate ${isFolder ? 'text-[#EDEDEF] font-medium' : 'text-[#8A8F98] group-hover:text-[#EDEDEF] transition-colors'}`}
              title={node.path}
            >
              {label}
            </span>
          </div>
        </div>
        <div className="justify-self-end text-right text-[#8A8F98] text-xs tabular-nums">{typeof node.size === 'number' ? formatBytes(node.size) : '-'}</div>
        <div className="justify-self-end text-right text-[#8A8F98] text-xs tabular-nums">{isFolder ? node.files ?? 0 : '-'}</div>
        <div className="justify-self-end text-right text-[#8A8F98] text-xs tabular-nums">{isFolder ? node.folders ?? 0 : '-'}</div>
      </div>
      {isFolder && expanded && hasVisibleChildren && (
        <div>
          {visibleChildren.map((child, i) => (
            <div key={child.path || `${child.name}-${i}`}>
              <TreeNode
                node={child}
                depth={depth + 1}
                recursive={recursive}
                disabled={disabled}
                onRemove={onRemove}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
