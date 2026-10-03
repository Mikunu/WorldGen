# Подготовка выпуска

Git-репозиторий начинается в папке настольного проекта. Соседние папки исходного браузерного проекта находятся за его пределами. В Git входят исходники Tauri, общий расчётный код, тесты, документация и сценарии сборки. `node_modules`, `dist`, `output`, `release`, кэш пакетов и `src-tauri/target` исключены.

## Локальная подготовка

```powershell
.\setup.cmd
node --test tests/*.test.mjs
node scripts/build-frontend.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
.\build.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-release.ps1
```

Последняя команда работает только с локальными файлами. Она проверяет версии в `package.json`, `Cargo.toml`, конфигурации Tauri и названии описания выпуска; упаковывает переносимый EXE, копирует установщик, считает SHA-256 и проверяет содержимое ZIP. Результат находится в `release/`. GitHub API, `git push` и сетевые загрузки этот сценарий не использует.

Для 0.5.0 подготовлены название **WorldGen 0.5.0 — редактор мира для Windows**, тег **v0.5.0**, описание [v0.5.0.md](releases/v0.5.0.md). Рекомендуемый тип выпуска — **pre-release**, поскольку модель остаётся прототипом. Точные размеры и суммы записываются в `release/release-manifest.json`.

## Публикация на GitHub

После отдельного разрешения на публикацию:

1. Выбрать GitHub-репозиторий и видимость.
2. Проверить `git diff --cached` и `git ls-files`; сделать коммит проверенного содержимого и создать тег `v0.5.0`.
3. Отправить выбранную ветку и тег в согласованный репозиторий.
4. Создать черновик GitHub Release с указанным тегом и описанием из `docs/releases/v0.5.0.md`.
5. Прикрепить ZIP, установщик и `SHA256SUMS.txt` из `release/`; сверить суммы с манифестом.
6. Опубликовать предварительный выпуск.

Сценария автоматической публикации нет. Workflow `.github/workflows/checks.yml` запускает проверки без создания релизов и имеет только права чтения содержимого. Загрузка исходников в репозиторий и публикация установщика через GitHub Release выполняются отдельно.

Официальное описание полей и файлов GitHub Release: [GitHub Docs](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
