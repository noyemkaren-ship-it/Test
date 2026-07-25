# Provenance текущего репозитория

## Что подтверждается Git

В доступной истории этого архива присутствуют два коммита:

```text
8edb8d9 First commit
510af02 New commit
```

Первый доступный commit уже содержит архитектуру Graph Platform v3 на React/TypeScript/React Flow, Express и SQLite. Файл `backend/src/HoneyOrm.js` помечен в самом исходнике как архивный прототип и не подключён к runtime v3.

Проверить эти факты можно командами:

```bash
git log --reverse --oneline
git show --stat --oneline 8edb8d9
git grep -n "ARCHIVED PROTOTYPE" 8edb8d9 -- backend/src/HoneyOrm.js
git grep -n "better-sqlite3" 8edb8d9 -- backend/package.json
```

## Граница доказуемого

В этой Git-истории нет commit, tag, remote reference или merge-base, которые документально связывают текущий репозиторий с отдельно упоминавшимися ранним PostgreSQL/Drizzle-репозиторием и сборкой v2.4 на SQLite. Поэтому такая цепочка не заявляется как установленный факт.

Это не runtime-дефект текущей версии: сборка, БД и функциональность v3 проверяются независимо через `scripts/audit.sh`. Для восстановления внешней истории потребуется хотя бы один первичный артефакт: архив старого репозитория с `.git`, commit hash, URL/remote или подписанный export. После его получения происхождение можно проверить через содержимое деревьев и историю коммитов, а не по текстовым отчётам.

