import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export function apiError(status: number, code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status);
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (exception instanceof ZodError) {
      return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '请求字段不符合要求', fields: exception.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } });
    }
    if (typeof exception === 'object' && exception !== null && 'type' in exception && exception.type === 'entity.too.large') return response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求内容超过大小限制' } });
    if (exception instanceof SyntaxError && 'body' in exception) return response.status(400).json({ error: { code: 'INVALID_JSON', message: '请求 JSON 格式错误' } });
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return response.status(409).json({ error: { code: 'CONFLICT', message: '记录已存在' } });
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'object') {
        return response.status(exception.getStatus()).json(body);
      }
      if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' && 'message' in body && typeof body.message === 'string') {
        return response.status(exception.getStatus()).json({ error: { code: body.code, message: body.message, ...('fields' in body ? { fields: body.fields } : {}) } });
      }
      return response.status(exception.getStatus()).json({ error: { code: `HTTP_${exception.getStatus()}`, message: exception.message } });
    }
    // Never serialize DB errors, request bodies, tokens, or upstream responses.
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } });
  }
}
