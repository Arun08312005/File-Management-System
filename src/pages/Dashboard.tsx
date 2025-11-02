import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FolderPlus, LogOut, HardDrive, RefreshCw } from "lucide-react";
import FileUpload from "@/components/FileUpload";
import FileList from "@/components/FileList";
import { useToast } from "@/hooks/use-toast";
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

interface Profile {
  storage_used: number;
  storage_limit: number;
  full_name: string;
}

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    loadProfile();
  }, [user, refreshTrigger]);

  const loadProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("storage_used, storage_limit, full_name")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error('Profile load error:', error);
      } else {
        setProfile(data);
      }
    } catch (error) {
      console.error('Profile load error:', error);
    }
  };

  const createFolder = async () => {
    if (!user || !folderName.trim()) return;

    try {
      const { error } = await supabase
        .from("folders")
        .insert({
          name: folderName.trim(),
          parent_id: currentFolder,
          owner_id: user.id,
        });

      if (error) throw error;

      toast({
        title: "Folder created",
        description: `Folder "${folderName}" has been created`,
      });

      setShowCreateFolder(false);
      setFolderName("");
      refreshFileList();
    } catch (error: any) {
      toast({
        title: "Failed to create folder",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const refreshFileList = () => {
    console.log('Refreshing file list...');
    setRefreshTrigger(prev => prev + 1);
  };

  const storagePercentage = profile
    ? (profile.storage_used / profile.storage_limit) * 100
    : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card shadow-soft">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-primary">
                <HardDrive className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Scalable File Management System</h1>
                <p className="text-sm text-muted-foreground">
                  Welcome, {profile?.full_name || user?.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="icon"
                onClick={refreshFileList}
                title="Refresh files"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        <Card className="shadow-medium">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              Storage Usage
            </CardTitle>
            <CardDescription>
              {profile ? `${formatBytes(profile.storage_used)} of ${formatBytes(profile.storage_limit)} used` : 'Loading...'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={storagePercentage} className="h-2" />
            <p className="text-sm text-muted-foreground mt-2">
              {storagePercentage.toFixed(1)}% of your storage is in use
            </p>
          </CardContent>
        </Card>

        <div className="flex gap-3 flex-wrap">
          <Button onClick={() => setShowUpload(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Files
          </Button>
          <Button 
            onClick={() => setShowCreateFolder(true)} 
            variant="outline" 
            className="gap-2"
          >
            <FolderPlus className="h-4 w-4" />
            New Folder
          </Button>
        </div>

        {showUpload && (
          <FileUpload
            currentFolder={currentFolder}
            onUploadComplete={() => {
              console.log('Upload complete, refreshing...');
              refreshFileList();
              setShowUpload(false);
            }}
            onClose={() => setShowUpload(false)}
          />
        )}

        <FileList 
          currentFolder={currentFolder} 
          onFolderChange={setCurrentFolder}
          onRefresh={refreshFileList}
          key={refreshTrigger}
        />

        <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Folder</DialogTitle>
              <DialogDescription>
                Enter a name for your new folder
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="folder-name">Folder Name</Label>
                <Input
                  id="folder-name"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createFolder()}
                  placeholder="Enter folder name"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateFolder(false)}>
                Cancel
              </Button>
              <Button onClick={createFolder}>Create Folder</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Dashboard;