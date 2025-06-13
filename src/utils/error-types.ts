/**
 * Centralized Error Types and Handling for Claude-Flow
 */

export interface ErrorContext {
  originalError?: Error;
  userMessage?: string;
  recoverable?: boolean;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
}

export class ClaudeFlowError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly recoverable: boolean;
  public readonly retryable: boolean;
  public readonly originalError?: Error;
  public readonly metadata: Record<string, unknown>;

  constructor(message: string, code: string, context: ErrorContext = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.userMessage = context.userMessage || message;
    this.recoverable = context.recoverable ?? true;
    this.retryable = context.retryable ?? false;
    if (context.originalError !== undefined) {
      this.originalError = context.originalError;
    }
    this.metadata = context.metadata || {};

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      userMessage: this.userMessage,
      recoverable: this.recoverable,
      retryable: this.retryable,
      metadata: this.metadata,
      stack: this.stack,
    };
  }
}

export class SwarmError extends ClaudeFlowError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'SWARM_ERROR', context);
  }
}

export class TaskExecutionError extends ClaudeFlowError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'TASK_EXECUTION_ERROR', { ...context, retryable: true });
  }
}

export class MemoryError extends ClaudeFlowError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'MEMORY_ERROR', context);
  }
}

export class MCPError extends ClaudeFlowError {
  constructor(message: string, context: ErrorContext & { method?: string; mcpError?: any } = {}) {
    super(message, 'MCP_ERROR', { ...context, retryable: true });
  }
}

export class TerminalError extends ClaudeFlowError {
  constructor(message: string, context: ErrorContext & { terminalId?: string } = {}) {
    super(message, 'TERMINAL_ERROR', context);
  }
}

export class CoordinationError extends ClaudeFlowError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'COORDINATION_ERROR', context);
  }
}

/**
 * Error Recovery Utilities
 */
export interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;
  operation: string;
  shouldRetry?: (error: Error) => boolean;
}

export class ErrorRecovery {
  static async retryOperation<T>(
    operation: () => Promise<T>,
    options: RetryOptions
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if we should retry this error
        if (options.shouldRetry && !options.shouldRetry(lastError)) {
          throw lastError;
        }

        // Last attempt - don't wait
        if (attempt === options.maxAttempts) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = options.backoffMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new ClaudeFlowError(
      `Operation '${options.operation}' failed after ${options.maxAttempts} attempts`,
      'RETRY_EXHAUSTED',
      {
        ...(lastError && { originalError: lastError }),
        userMessage: `Unable to complete ${options.operation} after multiple attempts. Please check system resources and try again.`,
        retryable: true,
        metadata: { attempts: options.maxAttempts, operation: options.operation }
      }
    );
  }

  static isRetryable(error: Error): boolean {
    if (error instanceof ClaudeFlowError) {
      return error.retryable;
    }

    // Common retryable patterns
    const retryablePatterns = [
      /timeout/i,
      /connection/i,
      /network/i,
      /temporary/i,
      /try again/i,
      /rate limit/i,
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  static isRecoverable(error: Error): boolean {
    if (error instanceof ClaudeFlowError) {
      return error.recoverable;
    }

    // Fatal error patterns
    const fatalPatterns = [
      /out of memory/i,
      /disk full/i,
      /permission denied/i,
      /access denied/i,
      /authentication/i,
      /authorization/i,
    ];

    return !fatalPatterns.some(pattern => pattern.test(error.message));
  }
}

/**
 * User-Friendly Error Messages
 */
export class ErrorMessages {
  private static readonly messageMap: Record<string, string> = {
    // Swarm errors
    'SWARM_ERROR': 'Unable to start or manage the agent swarm',
    'TASK_EXECUTION_ERROR': 'Task could not be completed successfully',
    
    // Memory errors
    'MEMORY_ERROR': 'Unable to save or retrieve information',
    
    // MCP errors
    'MCP_ERROR': 'AI service communication failed',
    
    // Terminal errors
    'TERMINAL_ERROR': 'Terminal connection or command execution failed',
    
    // Coordination errors
    'COORDINATION_ERROR': 'Agent coordination system encountered an issue',
    
    // Retry errors
    'RETRY_EXHAUSTED': 'Operation failed after multiple attempts',
  };

  static getUserMessage(error: Error): string {
    if (error instanceof ClaudeFlowError && error.userMessage) {
      return error.userMessage;
    }

    if (error instanceof ClaudeFlowError && this.messageMap[error.code]) {
      return this.messageMap[error.code];
    }

    // Fallback for unknown errors
    return 'An unexpected error occurred. Please try again or contact support if the problem persists.';
  }

  static getActionableMessage(error: Error): string {
    const baseMessage = this.getUserMessage(error);
    
    if (error instanceof ClaudeFlowError && error.retryable) {
      return `${baseMessage} You can try the operation again.`;
    }

    if (error instanceof ClaudeFlowError && !error.recoverable) {
      return `${baseMessage} Please restart the system or contact support.`;
    }

    return baseMessage;
  }
}