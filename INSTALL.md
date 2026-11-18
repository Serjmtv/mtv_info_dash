# Установка Tokens

Tokens — расширение VS Code. Показывает, сколько осталось лимитов Claude Code и Codex, куда ушли токены, какие чаты открыты, и умеет переходить в любой чат.

## Что нужно

- VS Code 1.90 или новее.
- Расширение **Claude Code** и/или **Codex** (OpenAI) в VS Code, с вашей подпиской.
- Windows. На macOS и Linux лимиты и графики работают, но список открытых чатов и кнопка «Остановить все чаты» пока только для Windows.

## Способ 1. Попросить агента

Откройте чат Claude Code или Codex в VS Code и вставьте промт:

```text
Установи мне VS Code-расширение Tokens из https://github.com/Serjmtv/mtv_info_dash.
1. Скачай .vsix из последнего релиза: gh release download --repo Serjmtv/mtv_info_dash --pattern "*.vsix" --dir $env:TEMP
   (если gh нет — скачай файл со страницы https://github.com/Serjmtv/mtv_info_dash/releases/latest).
2. Установи: code --install-extension <путь к скачанному .vsix> --force
3. Спроси меня, где лежит папка с моими проектами, и запиши её в настройку VS Code "tokens.projectsRoot"
   (если в ней есть файл projects.code-workspace, проекты возьмутся из него).
4. Скажи мне перезагрузить окно: Ctrl+Shift+P → Developer: Reload Window.
Ничего, кроме этого, не меняй.
```

## Способ 2. Вручную

1. Скачайте файл `tokens-*.vsix` со страницы [последнего релиза](https://github.com/Serjmtv/mtv_info_dash/releases/latest).
2. Установите:
   ```powershell
   code --install-extension $HOME\Downloads\tokens-0.2.4.vsix --force
   ```
   Или в VS Code: панель «Расширения» → `…` → **Install from VSIX…**
3. `Ctrl+Shift+P` → **Developer: Reload Window**.
4. Укажите папку с проектами: `Ctrl+,` → найдите `tokens.projectsRoot`. Если не указать, берётся папка, открытая в VS Code (или папка с открытым файлом `.code-workspace`).

После перезагрузки внизу справа появятся `Claude …%` и `Codex …%`, а слева — иконка-спидометр. Клик по процентам открывает дашборд.

## Способ 3. Собрать из исходников

Нужен Node.js 20+.

```powershell
git clone https://github.com/Serjmtv/mtv_info_dash.git
cd mtv_info_dash
npm ci
powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -Install
```

Скрипт собирает интерфейс (`npm run build`), упаковывает `.vsix` и ставит его в VS Code.

## Что расширение читает и делает

- **Лимиты Codex** — из логов `~/.codex/sessions`.
- **Лимиты Claude** — из `~/.claude.json`. Раз в 5 минут расширение обновляет их, запуская официальный `claude.exe -p "/usage"` из расширения Claude Code. Это без запроса к модели: токены не тратятся. Отключается настройкой `tokens.claudeRefreshMinutes = 0`.
- **Расход токенов и список чатов** — из транскриптов `~/.claude/projects` и логов Codex.
- **Проекты** — git и `STATUS.md` в папках из `tokens.projectsRoot`.

Файлы с токенами авторизации расширение не открывает и само в сеть не ходит. Всё остаётся на вашем компьютере.

**Кнопка «Остановить все чаты»** завершает процессы чатов Claude и Codex — после подтверждения. История при этом сохраняется.
