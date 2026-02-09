/**
 * CodeEditor - Monaco-based code editor with lock awareness
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Loader2 } from 'lucide-react';

// Monaco editor will load from CDN by default

// Language mapping from our types to Monaco languages
const languageMap: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  json: 'json',
  yaml: 'yaml',
  dockerfile: 'dockerfile',
  markdown: 'markdown',
  shell: 'shell',
  css: 'css',
  html: 'html',
};

interface CodeEditorProps {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  isLocked?: boolean;
  lockOwner?: string;
  height?: string | number;
  className?: string;
  onSave?: (value: string) => void;
  showMinimap?: boolean;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
}

export const CodeEditor = memo(function CodeEditor({
  value,
  language,
  onChange,
  readOnly = false,
  isLocked = false,
  lockOwner,
  height = '400px',
  className = '',
  onSave,
  showMinimap = true,
  wordWrap = 'on',
}: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const monacoLanguage = languageMap[language.toLowerCase()] || 'plaintext';

  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      setIsLoading(false);

      // Add Ctrl+S / Cmd+S save handler
      if (onSave) {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onSave(editor.getValue());
        });
      }

      // Focus editor
      editor.focus();
    },
    [onSave]
  );

  const handleChange: OnChange = useCallback(
    (newValue) => {
      if (onChange && newValue !== undefined) {
        onChange(newValue);
      }
    },
    [onChange]
  );

  // Update readOnly when lock status changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        readOnly: readOnly || isLocked,
      });
    }
  }, [readOnly, isLocked]);

  const effectiveReadOnly = readOnly || isLocked;

  return (
    <div className={`relative ${className}`}>
      {/* Lock overlay */}
      {isLocked && lockOwner && (
        <div className="absolute inset-0 z-10 bg-gray-900/80 flex items-center justify-center pointer-events-none">
          <div className="bg-gray-800 border border-yellow-500/50 rounded-lg px-4 py-3 text-center">
            <p className="text-yellow-400 text-sm font-medium">File is locked</p>
            <p className="text-gray-400 text-xs mt-1">Editing by: {lockOwner}</p>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 z-20 bg-gray-900 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      )}

      <Editor
        height={height}
        language={monacoLanguage}
        value={value}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          readOnly: effectiveReadOnly,
          minimap: { enabled: showMinimap },
          wordWrap,
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 8, bottom: 8 },
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          cursorBlinking: 'smooth',
          smoothScrolling: true,
          folding: true,
          lineDecorationsWidth: 10,
          glyphMargin: false,
          tabSize: 2,
          insertSpaces: true,
          formatOnPaste: true,
          formatOnType: true,
        }}
        loading={null}
      />
    </div>
  );
});

export default CodeEditor;
