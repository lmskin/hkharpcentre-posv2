# 店内部署手册（Deployment）

适用机器：店内 PC `DESKTOP-SS57NCD`（Windows，与旧 eRun 系统共存）
最后更新：2026-11-22 · 状态：生产构建冒烟通过、自启与备份已上线

---

## 1. 架构一览

| 组件 | 位置 | 端口 | 启动方式 |
|---|---|---|---|
| Next.js POS/BackOffice | `C:\hkharpcentre-posv2` | **3000** | 计划任务 `HKHarpPOS`（登录自启） |
| MySQL 8.0.33（本系统库 `hkharp_pos`） | `C:\Program Files\MySQL\MySQL Server 8.0` | **3306** | Windows 服务 `MySQL80`（自动启动） |
| 每日备份 | → `C:\eRun\Support\mysql\*.7z` | — | 计划任务 `HKHarpPOS-MySQL-Backup`（每日 13:37） |
| 旧系统（保留只读） | `C:\eRun`、SQL Server `tcp:localhost,2343` | 2343 | 原计划任务 `BACKUP`/`BACKUPeRUn`/`FTP` 照旧 |

注意：这台机器还有另一个项目 **schooltracs**（独立 MySQL 实例，端口 **3307**，datadir `C:\schooltracs`）。与本系统无关，**不要动它的库、服务或用户级环境变量**。

## 2. 关键环境陷阱（必读）

这台机器的 **用户级环境变量** 里残留 schooltracs 项目的配置：

```
DATABASE_URL = mysql://schooltracs:schooltracs@127.0.0.1:3307/schooltracs
MIGRATE_DATABASE_URL = 同上
```

Node 的规则：**已存在的环境变量优先于 `--env-file` 文件**。后果：从普通终端/计划任务启动时，`.env` 里的 `DATABASE_URL` 会被静默忽略，服务器会连去 3307 的 schooltracs 库（表现为 `/api/health` 报 `ER_NO_SUCH_TABLE`）。

- `scripts\start-pos.cmd` 已在启动前 `set "DATABASE_URL="` 清除，**不要删掉那两行**。
- 手动跑 `npm run db:migrate` / `etl:migrate` 等脚本前，先在同一个终端执行
  `set "DATABASE_URL="` 和 `set "MIGRATE_DATABASE_URL="`，否则脚本会作用到 schooltracs 库！
- 不能删除这些用户级变量——schooltracs 应用依赖它们。

## 3. 日常操作

### 启动 / 停止 / 重启 POS

```
schtasks /run /tn "HKHarpPOS"      :: 启动（登录时也会自动启动）
schtasks /end /tn "HKHarpPOS"      :: 停止
```

`scripts\start-pos.cmd` 带崩溃自愈循环：进程退出后 5 秒自动重启。
日志：`C:\hkharpcentre-posv2\logs\pos-server.log`
健康检查：浏览器打开 `http://localhost:3000/api/health`，应见 `"connected":true`、`tableCount:37`。

### 更新流程（git pull 后）

```
cd C:\hkharpcentre-posv2
git pull
set "DATABASE_URL="                :: 关键，见第 2 节
npm install                        :: 依赖有变化时
npm run db:migrate                 :: schema 有变化时
npm run build
schtasks /end /tn "HKHarpPOS" && schtasks /run /tn "HKHarpPOS"
```

构建产物在 `apps\web\.next`；重启计划任务即生效。

## 4. 备份与恢复

### 备份（自动）

- 每日 13:37 由 `HKHarpPOS-MySQL-Backup` 执行 `scripts\backup-mysql.ps1`：
  `mysqldump --single-transaction` → 7z 压缩 → `C:\eRun\Support\mysql\hkharp_pos_YYYYMMDD_HHMMSS.sql.7z`，保留 14 天，日志 `backup.log`。
- 凭据从 `.env` 的 `DATABASE_URL` 解析，不硬编码密码。
- 旧系统的 `BACKUPeRUn`（SQL Server → 7z）与 `FTP`（eRunBackup 异地）任务在平行运行期间**保持不动**。

### 手动备份

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\hkharpcentre-posv2\scripts\backup-mysql.ps1
```

### 恢复演练

```
:: 1. 解压
"C:\Program Files\7-Zip\7z.exe" x C:\eRun\Support\mysql\hkharp_pos_<时间戳>.sql.7z -oC:\temp\restore
:: 2. 建空库（如需要）
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "CREATE DATABASE hkharp_pos_restore CHARACTER SET utf8mb4;"
:: 3. 导入
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p hkharp_pos_restore < C:\temp\restore\hkharp_pos_<时间戳>.sql
:: 4. 验证表数 = 37，products / bills 行数与备份日志一致
```

最近一次演练：2026-11-22，备份 3.4 MB，解出 37 张 CREATE TABLE、71 批 INSERT，校验通过。

## 5. 断电恢复验收（目标 < 3 分钟）

1. 开机 → Windows 登录 → MySQL80 服务自动启动；
2. 计划任务 `HKHarpPOS` 在登录时拉起 `start-pos.cmd` → Next.js 约 1 秒就绪；
3. 打开 `http://localhost:3000/pos` 即可收银。
实测：手动触发任务到 `/api/health` 全绿约 15 秒。

## 6. 故障排查速查

| 症状 | 检查 |
|---|---|
| `/api/health` 报 `ER_NO_SUCH_TABLE` | 99% 是第 2 节的环境变量陷阱：确认进程是否经 `start-pos.cmd` 启动；`netstat -ano \| findstr :3307` 看有没有连错库 |
| 端口被占 | `netstat -ano \| findstr :3000`；开发用 dev server 在 3100，与生产 3000 不冲突 |
| 备份没跑 | `C:\eRun\Support\mysql\backup.log`；`schtasks /query /tn "HKHarpPOS-MySQL-Backup" /v` 看上次结果 |
| 登录后 POS 没自启 | `schtasks /query /tn "HKHarpPOS" /v`；手动 `schtasks /run /tn "HKHarpPOS"` |
