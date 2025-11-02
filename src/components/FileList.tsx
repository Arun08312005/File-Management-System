import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  FileIcon,
  FolderIcon,
  Download,
  Trash2,
  Share2,
  Grid3x3,
  List,
  MoreVertical,
  Edit,
  Copy,
  Check,
  ChevronRight,
  Home,
  ImageIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface File {
  id: string;
  name: string;
  file_type: string;
  file_size: number;
  file_path: string;
  created_at: string;
  original_name: string;
  folder_id: string | null;
}

interface Folder {
  id: string;
  name: string;
  created_at: string;
  parent_id: string | null;
}

interface Breadcrumb {
  id: string | null;
  name: string;
}

interface FileListProps {
  currentFolder: string | null;
  onFolderChange: (folderId: string | null) => void;
  onRefresh: () => void;
}

const FileList = ({ currentFolder, onFolderChange, onRefresh }: FileListProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; file: File | null }>({ open: false, file: null });
  const [folderRenameDialog, setFolderRenameDialog] = useState<{ open: boolean; folder: Folder | null }>({ open: false, folder: null });
  const [newName, setNewName] = useState("");
  const [folderNewName, setFolderNewName] = useState("");
  const [shareDialog, setShareDialog] = useState<{ open: boolean; file: File | null }>({ open: false, file: null });
  const [shareLink, setShareLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: File | Folder | null; type: 'file' | 'folder' | null }>({ open: false, item: null, type: null });
  const [previewDialog, setPreviewDialog] = useState<{ open: boolean; file: File | null }>({ open: false, file: null });
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: null, name: "All Files" }]);

  useEffect(() => {
    loadData();
    loadBreadcrumbs(currentFolder);
  }, [currentFolder, user]);

  const loadData = async () => {
    if (!user) return;

    console.log('Loading data for folder:', currentFolder);
    setLoading(true);
    try {
      // Load all folders for the user
      const { data: allFolders, error: foldersError } = await supabase
        .from("folders")
        .select("*")
        .eq("owner_id", user.id)
        .order("name");

      if (foldersError) {
        console.error('Folders error:', foldersError);
        throw foldersError;
      }

      // Filter folders based on current folder
      const filteredFolders = (allFolders || []).filter(folder => {
        if (currentFolder === null) {
          return folder.parent_id === null;
        } else {
          return folder.parent_id === currentFolder;
        }
      });

      setFolders(filteredFolders);
      console.log('Loaded folders:', filteredFolders.length);

      // Load all files for the user
      const { data: allFiles, error: filesError } = await supabase
        .from("files")
        .select("*")
        .eq("owner_id", user.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (filesError) {
        console.error('Files error:', filesError);
        throw filesError;
      }

      // Filter files based on current folder
      const filteredFiles = (allFiles || []).filter(file => {
        if (currentFolder === null) {
          return file.folder_id === null;
        } else {
          return file.folder_id === currentFolder;
        }
      });

      setFiles(filteredFiles);
      console.log('Loaded files:', filteredFiles.length);
    } catch (error: any) {
      console.error('Load data error:', error);
      toast({
        title: "Error loading files",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadBreadcrumbs = async (folderId: string | null) => {
    if (!folderId) {
      setBreadcrumbs([{ id: null, name: "All Files" }]);
      return;
    }

    try {
      const buildBreadcrumbs = async (id: string | null): Promise<Breadcrumb[]> => {
        if (!id) return [{ id: null, name: "All Files" }];
        
        const { data: folder } = await supabase
          .from("folders")
          .select("id, name, parent_id")
          .eq("id", id)
          .single();

        if (folder) {
          const parentCrumbs = await buildBreadcrumbs(folder.parent_id);
          return [...parentCrumbs, { id: folder.id, name: folder.name }];
        }
        return [{ id: null, name: "All Files" }];
      };

      const newBreadcrumbs = await buildBreadcrumbs(folderId);
      setBreadcrumbs(newBreadcrumbs);
    } catch (error) {
      console.error("Error loading breadcrumbs:", error);
      setBreadcrumbs([{ id: null, name: "All Files" }]);
    }
  };

  const downloadFile = async (file: File) => {
    try {
      toast({
        title: "Starting download...",
        description: `Preparing ${file.name}`,
      });

      const { data, error } = await supabase.storage
        .from("user-files")
        .download(file.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download started",
        description: `Downloading ${file.name}`,
      });
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const deleteFile = async (fileId: string) => {
    try {
      const { error } = await supabase
        .from("files")
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq("id", fileId);

      if (error) throw error;

      toast({
        title: "File moved to trash",
        description: "File can be permanently deleted from trash.",
      });

      loadData();
      onRefresh();
    } catch (error: any) {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const deleteFolder = async (folderId: string) => {
    try {
      const { error } = await supabase
        .from("folders")
        .delete()
        .eq("id", folderId);

      if (error) throw error;

      toast({
        title: "Folder deleted",
        description: "Folder has been permanently deleted",
      });

      loadData();
    } catch (error: any) {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openRenameDialog = (file: File) => {
    setRenameDialog({ open: true, file });
    setNewName(file.name);
  };

  const renameFile = async () => {
    if (!renameDialog.file || !newName.trim()) return;

    try {
      const { error } = await supabase
        .from("files")
        .update({ name: newName.trim() })
        .eq("id", renameDialog.file.id);

      if (error) throw error;

      toast({
        title: "File renamed",
        description: `File renamed to ${newName}`,
      });

      setRenameDialog({ open: false, file: null });
      loadData();
    } catch (error: any) {
      toast({
        title: "Rename failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openFolderRenameDialog = (folder: Folder) => {
    setFolderRenameDialog({ open: true, folder });
    setFolderNewName(folder.name);
  };

  const renameFolder = async () => {
    if (!folderRenameDialog.folder || !folderNewName.trim()) return;

    try {
      const { error } = await supabase
        .from("folders")
        .update({ name: folderNewName.trim() })
        .eq("id", folderRenameDialog.folder.id);

      if (error) throw error;

      toast({
        title: "Folder renamed",
        description: `Folder renamed to ${folderNewName}`,
      });

      setFolderRenameDialog({ open: false, folder: null });
      loadData();
    } catch (error: any) {
      toast({
        title: "Rename failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openShareDialog = async (file: File) => {
    try {
      const token = crypto.randomUUID();
      
      const { data, error } = await supabase
        .from("share_links")
        .insert({
          file_id: file.id,
          token,
          created_by: user!.id,
        })
        .select()
        .single();

      if (error) throw error;

      const link = `${window.location.origin}/share/${token}`;
      setShareLink(link);
      setShareDialog({ open: true, file });
      setCopied(false);
    } catch (error: any) {
      toast({
        title: "Share failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    toast({
      title: "Link copied",
      description: "Share link copied to clipboard",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const openDeleteDialog = (item: File | Folder, type: 'file' | 'folder') => {
    setDeleteDialog({ open: true, item, type });
  };

  const handleDelete = async () => {
    if (!deleteDialog.item || !deleteDialog.type) return;

    try {
      if (deleteDialog.type === 'file') {
        await deleteFile((deleteDialog.item as File).id);
      } else {
        await deleteFolder((deleteDialog.item as Folder).id);
      }

      setDeleteDialog({ open: false, item: null, type: null });
    } catch (error: any) {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const previewFile = async (file: File) => {
    if (!file.file_type.startsWith('image/')) {
      downloadFile(file);
      return;
    }

    try {
      const { data } = await supabase.storage
        .from("user-files")
        .createSignedUrl(file.file_path, 60);

      if (data) {
        setPreviewUrl(data.signedUrl);
        setPreviewDialog({ open: true, file });
      }
    } catch (error: any) {
      toast({
        title: "Preview failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) {
      return <ImageIcon className="h-6 w-6 text-green-500" />;
    }
    return <FileIcon className="h-6 w-6 text-blue-500" />;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getFileTypeBadge = (fileType: string) => {
    if (fileType.startsWith('image/')) return "Image";
    if (fileType.startsWith('video/')) return "Video";
    if (fileType.startsWith('audio/')) return "Audio";
    if (fileType === 'application/pdf') return "PDF";
    if (fileType.includes('document') || fileType.includes('word')) return "Document";
    if (fileType.includes('spreadsheet') || fileType.includes('excel')) return "Spreadsheet";
    if (fileType.includes('presentation') || fileType.includes('powerpoint')) return "Presentation";
    return "File";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFolderChange(null)}
            className="h-8 px-2"
          >
            <Home className="h-4 w-4" />
          </Button>
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.id} className="flex items-center gap-2">
              {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <button
                onClick={() => onFolderChange(crumb.id)}
                className={`hover:text-foreground transition-colors ${
                  index === breadcrumbs.length - 1 ? "text-foreground font-medium" : "text-muted-foreground"
                }`}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            {folders.length} folders, {files.length} files
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === "grid" ? "default" : "outline"}
              size="icon"
              onClick={() => setViewMode("grid")}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="icon"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {folders.length === 0 && files.length === 0 && (
        <Card className="shadow-soft">
          <CardContent className="py-12 text-center">
            <FileIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No files yet</h3>
            <p className="text-muted-foreground">
              Upload your first file to get started
            </p>
          </CardContent>
        </Card>
      )}

      {viewMode === "grid" && (folders.length > 0 || files.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {folders.map((folder) => (
            <Card
              key={folder.id}
              className="cursor-pointer hover:shadow-medium transition-smooth group"
              onClick={() => onFolderChange(folder.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950">
                    <FolderIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openFolderRenameDialog(folder)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openDeleteDialog(folder, 'folder')}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <h3 className="font-medium truncate">{folder.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDate(folder.created_at)}
                </p>
              </CardContent>
            </Card>
          ))}

          {files.map((file) => (
            <Card 
              key={file.id} 
              className="hover:shadow-medium transition-smooth cursor-pointer group"
              onClick={() => previewFile(file)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
                    {getFileIcon(file.file_type)}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => downloadFile(file)}>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openShareDialog(file)}>
                        <Share2 className="mr-2 h-4 w-4" />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openRenameDialog(file)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openDeleteDialog(file, 'file')}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <h3 className="font-medium truncate mb-2">{file.name}</h3>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs">
                    {getFileTypeBadge(file.file_type)}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.file_size)}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDate(file.created_at)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {viewMode === "list" && (folders.length > 0 || files.length > 0) && (
        <Card className="shadow-soft">
          <CardContent className="p-0">
            <div className="divide-y">
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className="flex items-center justify-between p-4 hover:bg-secondary/50 cursor-pointer transition-smooth group"
                  onClick={() => onFolderChange(folder.id)}
                >
                  <div className="flex items-center gap-3">
                    <FolderIcon className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="font-medium">{folder.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Folder • {formatDate(folder.created_at)}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openFolderRenameDialog(folder)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openDeleteDialog(folder, 'folder')}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}

              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-4 hover:bg-secondary/50 transition-smooth cursor-pointer group"
                  onClick={() => previewFile(file)}
                >
                  <div className="flex items-center gap-3">
                    {getFileIcon(file.file_type)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          {getFileTypeBadge(file.file_type)}
                        </Badge>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(file.file_size)} • {formatDate(file.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => downloadFile(file)}>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openShareDialog(file)}>
                        <Share2 className="mr-2 h-4 w-4" />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openRenameDialog(file)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openDeleteDialog(file, 'file')}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={renameDialog.open} onOpenChange={(open) => setRenameDialog({ open, file: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription>
              Enter a new name for {renameDialog.file?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">File Name</Label>
              <Input
                id="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && renameFile()}
                placeholder="Enter new file name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog({ open: false, file: null })}>
              Cancel
            </Button>
            <Button onClick={renameFile}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderRenameDialog.open} onOpenChange={(open) => setFolderRenameDialog({ open, folder: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Enter a new name for {folderRenameDialog.folder?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder Name</Label>
              <Input
                id="folder-name"
                value={folderNewName}
                onChange={(e) => setFolderNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && renameFolder()}
                placeholder="Enter new folder name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderRenameDialog({ open: false, folder: null })}>
              Cancel
            </Button>
            <Button onClick={renameFolder}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shareDialog.open} onOpenChange={(open) => setShareDialog({ open, file: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share File</DialogTitle>
            <DialogDescription>
              Anyone with this link can download {shareDialog.file?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Input value={shareLink} readOnly />
              <Button onClick={copyShareLink} variant="outline" size="icon">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShareDialog({ open: false, file: null })}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, item: null, type: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {deleteDialog.type === 'file' ? 'File' : 'Folder'}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteDialog.item?.name}"? 
              {deleteDialog.type === 'folder' && ' This will also delete all contents inside the folder.'}
              {deleteDialog.type === 'file' && ' This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, item: null, type: null })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewDialog.open} onOpenChange={(open) => setPreviewDialog({ open, file: null })}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewDialog.file?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center">
            {previewDialog.file?.file_type.startsWith('image/') && previewUrl && (
              <img 
                src={previewUrl} 
                alt={previewDialog.file.name}
                className="max-h-[70vh] max-w-full object-contain rounded-lg"
              />
            )}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setPreviewDialog({ open: false, file: null })}>
              Close
            </Button>
            <Button onClick={() => previewDialog.file && downloadFile(previewDialog.file)}>
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FileList;