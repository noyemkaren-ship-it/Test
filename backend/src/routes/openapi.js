import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

router.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').sendFile(path.resolve(__dirname, '../../openapi.yaml'));
});

export default router;
