//go:build !windows

package files

import "os"

// DriveFs is unused on non-Windows platforms.
type DriveFs struct{}

// NewDriveFs returns a stub. Windows multi-drive mode is not available.
func NewDriveFs() *DriveFs { return &DriveFs{} }

func (d *DriveFs) Name() string { return "DriveFs-stub" }

func (d *DriveFs) RealPath(name string) (string, error) { return name, nil }

// LogicalDrive is unused outside Windows.
type LogicalDrive struct {
	Letter    string
	Root      string
	Label     string
	DriveType string
	Info      os.FileInfo
}

// ListLogicalDrives returns empty on non-Windows platforms.
func ListLogicalDrives() ([]LogicalDrive, error) { return nil, nil }
