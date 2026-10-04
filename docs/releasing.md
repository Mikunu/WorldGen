# Подготовка выпуска

Git-репозиторий начинается в папке настольного проекта. В Git входят исходники Tauri, общий расчётный код, тесты, документация, небольшие JSON-шаблоны в `examples/` и сценарии сборки. `node_modules`, `dist`, `output`, `release`, кэш пакетов и `src-tauri/target` исключены.

## Локальная подготовка

```powershell
.\setup.cmd
node scripts/set-version.mjs --check
node --test tests/*.test.mjs
node scripts/build-frontend.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
.\build.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-release.ps1
```

Последняя команда работает только с локальными файлами. Она проверяет версии приложения и описания, сверяет target/default/versioned EXE, упаковывает переносимый EXE, копирует установщик, считает SHA-256 и проверяет содержимое ZIP. Результат находится в `release/`.

Текущая версия — **0.1.0-alpha.1**, тег — **v0.1.0-alpha.1**, описание — [v0.1.0-alpha.1.md](releases/v0.1.0-alpha.1.md). Все текущие выпуски имеют канал alpha и публикуются как GitHub **pre-release**. Точные размеры и суммы записываются в `release/release-manifest.json`. Правила изменения номера и перехода к 1.0: [версии WorldGen](versioning.md).

## Публикация на GitHub

Репозиторий проекта — [Mikunu/WorldGen](https://github.com/Mikunu/WorldGen). Перед публикацией проверьте список изменённых и новых файлов, исключите локальные проекты и резервные копии, завершите проверки и подготовьте сборку. Затем:

1. Создать коммит проверенного содержимого. Автор проекта: Mikunu, `58949015+Mikunu@users.noreply.github.com`.
2. Создать новый тег из `release/release-manifest.json` на этом коммите и отправить ветку и тег. Не перемещать старые теги.
3. Создать GitHub pre-release с описанием соответствующей версии из `docs/releases/`.
4. Прикрепить ZIP, установщик и `SHA256SUMS.txt` из `release/`; сверить суммы с манифестом.
5. Проверить опубликованные файлы скачиванием и обновить ссылки README на фактически опубликованную версию.

Workflow `.github/workflows/checks.yml` выполняет проверки с правами чтения содержимого. Он не публикует релизы. Автоматическое отложенное выполнение commit/push/tag/upload настраивается после согласования конкретного репозитория, содержимого и времени запуска; напоминание о готовом выпуске само ничего не публикует.

Официальное описание полей и файлов GitHub Release: [GitHub Docs](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
