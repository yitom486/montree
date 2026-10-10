!macro customInstallMode
  # 强制单用户安装模式：直接跳过“为哪位用户安装该应用？”的冗余选择界面，
  # 直接进入“选择安装目录”界面，允许用户自由指定 D 盘等自定义安装位置。
  StrCpy $isForceCurrentInstall "1"
  StrCpy $isForceMachineInstall "0"
!macroend
