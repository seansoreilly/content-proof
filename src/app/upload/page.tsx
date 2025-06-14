"use client";

import FileUpload from "../../components/FileUpload";

export default function UploadPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-6">
        File Upload & SHA-256 Hash Generator
      </h1>
      <FileUpload />
    </main>
  );
}
