import { createFileRoute } from '@tanstack/react-router'
import MonacoEditor from '@monaco-editor/react';
import { useState } from 'react';

function CodeEditor({ filePath }) {
  const [code, setCode] = useState('');
  
  // Load file content
  // Save file content
  // Handle syntax highlighting based on file extension
  
  return (
    <MonacoEditor
      language="javascript"
      value={code}
      onChange={setCode}
      theme="vs-dark"
    />
  );
}

const Home = () => {
  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Home</h2>
      </div>
        <CodeEditor filePath="~/Desktop/test.js" />
    </div>
  )
}

export const Route = createFileRoute('/_app/')({
  component: Home,
})
