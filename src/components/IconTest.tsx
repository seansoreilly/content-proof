import { AlertCircle } from "lucide-react";

export default function IconTest() {
  return (
    <div className="flex items-center gap-2 p-4 bg-gray-100 dark:bg-gray-800 rounded-md">
      <AlertCircle className="text-red-500" />
      <span className="text-sm">Lucide React is working!</span>
    </div>
  );
}
