# API smoke test

Запустите Backend, затем:

```bash
python3 test/smoke.py
```

По умолчанию используется `http://127.0.0.1:3001/api`. Другой адрес:

```bash
GP_BASE_URL=http://127.0.0.1:3199 python3 test/smoke.py
```

Тест не требует внешних Python packages. Он проверяет health, публичный каталог без JWT, запрет guest mutation, регистрацию в персональный workspace, видимость public-графов, создание/чтение/удаление private-графа владельцем.
