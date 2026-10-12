!macro customInstallMode
  # 首次安装：强制单用户安装模式，直接跳过用户类型选择界面，
  # 进入“选择安装目录”界面，允许用户自由指定 D 盘等自定义安装位置。
  StrCpy $isForceCurrentInstall "1"
  StrCpy $isForceMachineInstall "0"
!macroend

!macro customInit
  ${if} ${isUpdated}
    # 软件自动更新模式：强制完全静默模式，直接在原安装路径原地覆写，不弹任何安装向导界面
    SetSilent silent
  ${endif}
!macroend

