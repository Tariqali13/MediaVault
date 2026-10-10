import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import type { LocalStorage } from '../storage/local.js';

/**
 * Endpoints that make the local driver behave like S3 signed POST / signed GET.
 * Only registered when STORAGE_DRIVER=local.
 */
export async function storageRoutes(app: FastifyInstance, storage: LocalStorage) {
  app.post('/storage/upload', { schema: { hide: true }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value);
        continue;
      }
      // Like S3, policy fields must come before the file.
      const policy = storage.readPolicy(fields.policy ?? '', fields.signature ?? '');
      if (!policy) throw new AppError(403, 'bad_policy', 'Upload link is invalid or has expired.');
      if (part.mimetype !== policy.contentType) throw new AppError(400, 'wrong_type', 'File type does not match the approved upload.');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of part.file) {
        size += chunk.length;
        if (size > policy.maxBytes) throw new AppError(413, 'too_large', 'File is larger than the approved upload.');
        chunks.push(chunk);
      }
      if (part.file.truncated) throw new AppError(413, 'too_large', 'File is too large.');
      await storage.put(policy.key, Buffer.concat(chunks));
      return reply.status(204).send();
    }
    throw new AppError(400, 'no_file', 'No file in upload.');
  });

  app.get<{ Params: { '*': string }; Querystring: { exp?: string; sig?: string; dl?: string } }>(
    '/storage/object/*',
    { schema: { hide: true } },
    async (req, reply) => {
      const key = req.params['*'];
      const exp = Number(req.query.exp);
      if (!req.query.sig || !storage.checkUrl(key, exp, req.query.sig, req.query.dl ?? '')) {
        throw new AppError(403, 'bad_signature', 'Link is invalid or has expired.');
      }
      const body = await storage.get(key).catch(() => null);
      if (!body) throw new AppError(404, 'not_found', 'File not found.');
      if (key.endsWith('.webp')) reply.type('image/webp');
      else reply.type('application/octet-stream');
      if (req.query.dl) reply.header('content-disposition', `attachment; filename="${req.query.dl.replace(/["\r\n]/g, '')}"`);
      // The URL itself expires, so the response can be cached until then.
      reply.header('cache-control', `private, max-age=${Math.max(0, Math.floor((exp - Date.now()) / 1000))}`);
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(body);
    },
  );
}
