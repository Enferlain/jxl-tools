import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Image as ImageIcon } from 'lucide-react';
import { FileNode } from '../types';
import { formatBytes } from '../utils/formatBytes';

interface TreeNodeProps {
  node: FileNode;
  depth?: number;
  recursive?: boolean;
}

export function TreeNode({ node, depth = 0, recursive = true }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(node.expanded || false);
  const isFolder = node.type === 'folder';
  
  const visibleChildren = node.children?.filter(child => recursive || child.type === 'file');
  const hasVisibleChildren = visibleChildren && visibleChildren.length > 0;
  
  return (
    <div>
      <div 
        className="flex items-center px-6 py-2 hover:bg-white/[0.04] cursor-pointer group text-sm transition-colors border-b border-white/[0.02] last:border-0 relative"
        onClick={() => isFolder && setExpanded(!expanded)}
      >
        <div 
          className="flex-1 flex items-center gap-2 min-w-0 relative pr-4"
          style={{ paddingLeft: `${depth * 20}px` }}
        >
          <div className="w-4 h-4 flex items-center justify-center text-[#8A8F98] group-hover:text-[#EDEDEF] transition-colors">
            {isFolder ? (
              (expanded && hasVisibleChildren) ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <span className="w-4" />
            )}
          </div>
          <div className={`${isFolder ? 'text-[#5E6AD2]' : 'text-[#8A8F98]'}`}>
            {isFolder ? <Folder size={14} className="fill-current opacity-20" /> : <ImageIcon size={14} />}
          </div>
          <span className={`truncate ${isFolder ? 'text-[#EDEDEF] font-medium' : 'text-[#8A8F98] group-hover:text-[#EDEDEF] transition-colors'}`}>
            {node.name}
          </span>
        </div>
        <div className="w-20 text-right text-[#8A8F98] text-xs tabular-nums">{typeof node.size === 'number' ? formatBytes(node.size) : '-'}</div>
        <div className="w-16 text-right text-[#8A8F98] text-xs tabular-nums">{isFolder ? node.files ?? 0 : '-'}</div>
        <div className="w-16 text-right text-[#8A8F98] text-xs tabular-nums">{isFolder ? node.folders ?? 0 : '-'}</div>
      </div>
      {isFolder && expanded && hasVisibleChildren && (
        <div>
          {visibleChildren.map((child, i) => (
            <div key={child.path || `${child.name}-${i}`}>
              <TreeNode node={child} depth={depth + 1} recursive={recursive} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
