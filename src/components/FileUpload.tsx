import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, FileIcon, CheckCircle2, AlertCircle } from "lucide-react";

interface FileUploadProps {
  currentFolder: string | null;
  onUploadComplete: () => void;
  onClose: () => void;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: "uploading" | "completed" | "error";
  error?: string;
}

const FileUpload = ({ currentFolder, onUploadComplete, onClose }: FileUploadProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  }, []);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || !user) return;

    const fileArray = Array.from(files);
    
    const validFiles = fileArray.filter(file => {
      if (file.size === 0) {
        toast({
          title: "Invalid file",
          description: `${file.name} is empty`,
          variant: "destructive",
        });
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    const initialFiles: UploadingFile[] = validFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      progress: 0,
      status: "uploading"
    }));
    
    setUploadingFiles(initialFiles);
    setIsUploading(true);

    for (let i = 0; i < validFiles.length; i++) {
      await uploadFile(validFiles[i], i);
    }

    setIsUploading(false);
    onUploadComplete();
  };

  const uploadFile = async (file: File, index: number) => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substr(2, 9)}-${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      setUploadingFiles(prev => 
        prev.map((f, idx) => 
          idx === index ? { ...f, progress: 10 } : f
        )
      );

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("user-files")
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        throw uploadError;
      }

      setUploadingFiles(prev => 
        prev.map((f, idx) => 
          idx === index ? { ...f, progress: 80 } : f
        )
      );

      const { error: dbError } = await supabase.from("files").insert({
        name: file.name,
        original_name: file.name,
        file_type: file.type || 'application/octet-stream',
        file_size: file.size,
        file_path: filePath,
        owner_id: user.id,
        folder_id: currentFolder,
      });

      if (dbError) {
        console.error('Database insert error:', dbError);
        throw dbError;
      }

      setUploadingFiles(prev => 
        prev.map((f, idx) => 
          idx === index ? { ...f, progress: 100, status: "completed" } : f
        )
      );

      console.log('File uploaded successfully:', file.name);
    } catch (error: any) {
      console.error('Upload error:', error);
      setUploadingFiles(prev => 
        prev.map((f, idx) => 
          idx === index ? { 
            ...f, 
            status: "error", 
            error: error.message || "Upload failed" 
          } : f
        )
      );
      
      toast({
        title: "Upload failed",
        description: `Failed to upload ${file.name}: ${error.message}`,
        variant: "destructive",
      });
    }
  };

  const removeUploadingFile = (fileId: string) => {
    setUploadingFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const getStatusIcon = (status: UploadingFile['status']) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
      default:
        return <FileIcon className="h-4 w-4 text-blue-500 flex-shrink-0" />;
    }
  };

  const completedCount = uploadingFiles.filter(f => f.status === "completed").length;
  const totalCount = uploadingFiles.length;

  return (
    <Card className="shadow-medium">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Upload Files</CardTitle>
          <CardDescription>
            {isUploading 
              ? `Uploading... (${completedCount}/${totalCount})`
              : "Drag and drop files or click to browse"
            }
          </CardDescription>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onClose}
          disabled={isUploading}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isUploading && uploadingFiles.length === 0 && (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-smooth cursor-pointer ${
              dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium mb-2">
              Drop files here or click to browse
            </p>
            <p className="text-sm text-muted-foreground">
              Support for all file types
            </p>
            <input
              id="file-input"
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files)}
            />
          </div>
        )}

        {uploadingFiles.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-medium text-sm">
              {isUploading ? "Uploading Files..." : "Upload Results"}
            </h3>
            {uploadingFiles.map((uploadFile, idx) => (
              <div 
                key={uploadFile.id} 
                className="space-y-2 p-3 rounded-lg bg-secondary/50 relative"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {getStatusIcon(uploadFile.status)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{uploadFile.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(uploadFile.file.size)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                      {uploadFile.status === "completed" 
                        ? "Complete" 
                        : uploadFile.status === "error"
                        ? "Failed"
                        : `${Math.round(uploadFile.progress)}%`
                      }
                    </span>
                    {!isUploading && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeUploadingFile(uploadFile.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                {uploadFile.status === "uploading" && (
                  <Progress value={uploadFile.progress} className="h-1" />
                )}
                {uploadFile.status === "error" && (
                  <p className="text-xs text-destructive">{uploadFile.error}</p>
                )}
              </div>
            ))}
            
            {!isUploading && (
              <div className="flex gap-2 pt-2">
                <Button 
                  onClick={() => setUploadingFiles([])}
                  variant="outline"
                  className="flex-1"
                >
                  Clear List
                </Button>
                <Button 
                  onClick={() => document.getElementById("file-input")?.click()}
                  className="flex-1"
                >
                  Add More Files
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FileUpload;