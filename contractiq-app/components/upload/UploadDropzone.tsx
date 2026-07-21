'use client'

import { useRef, useState, type DragEvent } from 'react'

const MAX_FILE_SIZE = 10 * 1024 * 1024

interface UploadDropzoneProps {
  file: File | null
  onFileSelected: (file: File | null, error: string | null) => void
  disabled?: boolean
}

function validateFile(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) return 'Only PDF files are supported.'
  if (file.size > MAX_FILE_SIZE) return 'File must be 10MB or smaller.'
  return null
}

export function UploadDropzone({ file, onFileSelected, disabled }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleFiles(fileList: FileList | null) {
    const picked = fileList?.[0]
    if (!picked) return
    const error = validateFile(picked)
    onFileSelected(error ? null : picked, error)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    if (disabled) return
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="type-body-sm text-grey-500">Contract PDF</span>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`type-body-lg flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors duration-100 ease-out ${
          disabled
            ? 'cursor-not-allowed border-grey-100 bg-grey-25 text-grey-400'
            : isDragging
              ? 'border-blue-500 bg-blue-50 text-blue-500'
              : 'border-grey-200 bg-white text-grey-500 hover:border-blue-300'
        }`}
      >
        {file ? (
          <span className="text-grey-900">{file.name}</span>
        ) : disabled ? (
          <span>Select a contract type first</span>
        ) : (
          <span>Drag and drop a PDF here, or click to browse (max 10MB)</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
    </div>
  )
}
