/**
 * CodePreview - Display generated code with syntax highlighting
 */
import { memo, useState } from 'react';
import {
  FileCode,
  FileText,
  Settings,
  TestTube,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';
import type { GeneratedFile } from '../../types';

interface CodePreviewProps {
  files: GeneratedFile[];
  className?: string;
}

const languageColors: Record<string, string> = {
  typescript: 'text-blue-400',
  javascript: 'text-yellow-400',
  json: 'text-orange-400',
  yaml: 'text-pink-400',
  dockerfile: 'text-cyan-400',
  markdown: 'text-gray-400',
};

const purposeIcons: Record<string, typeof FileCode> = {
  service: FileCode,
  config: Settings,
  test: TestTube,
  documentation: FileText,
};

function getLanguageColor(language: string): string {
  return languageColors[language.toLowerCase()] || 'text-gray-400';
}

function getPurposeIcon(purpose: string): typeof FileCode {
  // Check for keywords in purpose
  if (purpose.toLowerCase().includes('test')) return TestTube;
  if (purpose.toLowerCase().includes('config')) return Settings;
  if (purpose.toLowerCase().includes('doc')) return FileText;
  return purposeIcons[purpose.toLowerCase()] || FileCode;
}

interface FileItemProps {
  file: GeneratedFile;
  isExpanded: boolean;
  onToggle: () => void;
}

const FileItem = memo(function FileItem({ file, isExpanded, onToggle }: FileItemProps) {
  const [copied, setCopied] = useState(false);
  const Icon = getPurposeIcon(file.purpose);
  const colorClass = getLanguageColor(file.language);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Get filename from path
  const filename = file.path.split('/').pop() || file.path;

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      {/* File Header */}
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-800/50 hover:bg-gray-800 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown size={16} className="text-gray-400" />
          ) : (
            <ChevronRight size={16} className="text-gray-400" />
          )}
          <Icon size={18} className={colorClass} />
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{filename}</span>
              {file.isNew && (
                <span className="px-1.5 py-0.5 text-xs bg-green-500/10 text-green-400 rounded">
                  NEW
                </span>
              )}
              {file.isTest && (
                <span className="px-1.5 py-0.5 text-xs bg-purple-500/10 text-purple-400 rounded">
                  TEST
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">{file.path}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${colorClass}`}>{file.language}</span>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors"
            title="Copy code"
          >
            {copied ? (
              <Check size={14} className="text-green-400" />
            ) : (
              <Copy size={14} className="text-gray-400" />
            )}
          </button>
        </div>
      </div>

      {/* Code Content */}
      {isExpanded && (
        <div className="border-t border-gray-700">
          <div className="p-4 bg-gray-900/50 overflow-x-auto">
            <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">
              <code>{file.content}</code>
            </pre>
          </div>
          {file.purpose && (
            <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/30">
              <span className="text-xs text-gray-500">Purpose: </span>
              <span className="text-xs text-gray-400">{file.purpose}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const CodePreview = memo(function CodePreview({
  files,
  className = '',
}: CodePreviewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (fileId: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedFiles(new Set(files.map((f) => f.id)));
  };

  const collapseAll = () => {
    setExpandedFiles(new Set());
  };

  // Group files by type
  const sourceFiles = files.filter((f) => !f.isTest);
  const testFiles = files.filter((f) => f.isTest);

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCode size={18} className="text-blue-400" />
          <h3 className="text-sm font-medium text-gray-300">Generated Files</h3>
          <span className="text-xs text-gray-500">({files.length} files)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Files List */}
      <div className="p-4 space-y-3">
        {files.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FileCode size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No files generated yet</p>
          </div>
        ) : (
          <>
            {/* Source Files */}
            {sourceFiles.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Source Files ({sourceFiles.length})
                </h4>
                {sourceFiles.map((file) => (
                  <FileItem
                    key={file.id}
                    file={file}
                    isExpanded={expandedFiles.has(file.id)}
                    onToggle={() => toggleFile(file.id)}
                  />
                ))}
              </div>
            )}

            {/* Test Files */}
            {testFiles.length > 0 && (
              <div className="space-y-2 mt-4">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Test Files ({testFiles.length})
                </h4>
                {testFiles.map((file) => (
                  <FileItem
                    key={file.id}
                    file={file}
                    isExpanded={expandedFiles.has(file.id)}
                    onToggle={() => toggleFile(file.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
