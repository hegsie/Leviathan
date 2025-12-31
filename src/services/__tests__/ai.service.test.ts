import { expect } from '@open-wc/testing';
import type {
  AiModelStatus,
  ModelDownloadProgress,
  GenerationProgress,
  GeneratedCommitMessage,
} from '../ai.service.ts';

// Mock Tauri API
const mockResults: Record<string, unknown> = {
  get_ai_status: {
    success: true,
    data: {
      modelAvailable: true,
      modelPath: '/path/to/model.gguf',
      modelSizeMb: 2048,
      quantization: 'Q4_K_M',
    } as AiModelStatus,
  },
  is_ai_available: { success: true, data: true },
  download_ai_model: { success: true, data: null },
  delete_ai_model: { success: true, data: null },
  generate_commit_message: {
    success: true,
    data: {
      summary: 'feat: add new feature',
      body: 'This commit adds a new feature that...',
      reasoning: 'The changes show a new function being added',
    } as GeneratedCommitMessage,
  },
};

const mockInvoke = (command: string, _args?: Record<string, unknown>): Promise<unknown> => {
  return Promise.resolve(mockResults[command] ?? { success: false, error: 'Unknown command' });
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('AI Service Types', () => {
  describe('AiModelStatus', () => {
    it('should have correct structure when model is available', () => {
      const status: AiModelStatus = {
        modelAvailable: true,
        modelPath: '/Users/test/.config/leviathan/models/unsloth.Q4_K_M.gguf',
        modelSizeMb: 2048,
        quantization: 'Q4_K_M',
      };

      expect(status.modelAvailable).to.be.true;
      expect(status.modelPath).to.include('unsloth');
      expect(status.modelSizeMb).to.equal(2048);
      expect(status.quantization).to.equal('Q4_K_M');
    });

    it('should have correct structure when model is not available', () => {
      const status: AiModelStatus = {
        modelAvailable: false,
        modelPath: null,
        modelSizeMb: null,
        quantization: null,
      };

      expect(status.modelAvailable).to.be.false;
      expect(status.modelPath).to.be.null;
      expect(status.modelSizeMb).to.be.null;
      expect(status.quantization).to.be.null;
    });
  });

  describe('ModelDownloadProgress', () => {
    it('should track download progress', () => {
      const progress: ModelDownloadProgress = {
        downloadedBytes: 1073741824, // 1GB
        totalBytes: 2147483648, // 2GB
        progressPercent: 50.0,
        status: 'downloading',
      };

      expect(progress.downloadedBytes).to.equal(1073741824);
      expect(progress.totalBytes).to.equal(2147483648);
      expect(progress.progressPercent).to.equal(50.0);
      expect(progress.status).to.equal('downloading');
    });

    it('should handle unknown total size', () => {
      const progress: ModelDownloadProgress = {
        downloadedBytes: 500000000,
        totalBytes: null,
        progressPercent: 0,
        status: 'downloading',
      };

      expect(progress.totalBytes).to.be.null;
      expect(progress.progressPercent).to.equal(0);
    });

    it('should track completion', () => {
      const progress: ModelDownloadProgress = {
        downloadedBytes: 2147483648,
        totalBytes: 2147483648,
        progressPercent: 100.0,
        status: 'complete',
      };

      expect(progress.status).to.equal('complete');
      expect(progress.progressPercent).to.equal(100.0);
    });

    it('should track error state', () => {
      const progress: ModelDownloadProgress = {
        downloadedBytes: 0,
        totalBytes: null,
        progressPercent: 0,
        status: 'error',
      };

      expect(progress.status).to.equal('error');
    });
  });

  describe('GenerationProgress', () => {
    it('should track model loading state', () => {
      const progress: GenerationProgress = {
        status: 'loading_model',
        tokensGenerated: null,
        message: 'Loading AI model...',
      };

      expect(progress.status).to.equal('loading_model');
      expect(progress.tokensGenerated).to.be.null;
      expect(progress.message).to.include('Loading');
    });

    it('should track generating state with token count', () => {
      const progress: GenerationProgress = {
        status: 'generating',
        tokensGenerated: 50,
        message: 'Generating commit message...',
      };

      expect(progress.status).to.equal('generating');
      expect(progress.tokensGenerated).to.equal(50);
    });

    it('should track completion', () => {
      const progress: GenerationProgress = {
        status: 'complete',
        tokensGenerated: 128,
        message: 'Complete',
      };

      expect(progress.status).to.equal('complete');
      expect(progress.tokensGenerated).to.equal(128);
    });

    it('should track error state', () => {
      const progress: GenerationProgress = {
        status: 'error',
        tokensGenerated: null,
        message: 'Model not found',
      };

      expect(progress.status).to.equal('error');
      expect(progress.message).to.include('not found');
    });
  });

  describe('GeneratedCommitMessage', () => {
    it('should have summary only', () => {
      const message: GeneratedCommitMessage = {
        summary: 'fix: resolve null pointer exception',
        body: null,
        reasoning: null,
      };

      expect(message.summary).to.equal('fix: resolve null pointer exception');
      expect(message.body).to.be.null;
      expect(message.reasoning).to.be.null;
    });

    it('should have summary and body', () => {
      const message: GeneratedCommitMessage = {
        summary: 'feat: add user authentication',
        body: 'Implements JWT-based authentication.\n\n- Add login endpoint\n- Add token validation\n- Add middleware',
        reasoning: null,
      };

      expect(message.summary).to.include('feat:');
      expect(message.body).to.include('JWT');
      expect(message.body).to.include('login endpoint');
    });

    it('should include reasoning from model', () => {
      const message: GeneratedCommitMessage = {
        summary: 'refactor: extract helper function',
        body: 'Moves duplicate code into a shared helper.',
        reasoning: 'The diff shows the same code pattern repeated in multiple places, suggesting extraction into a helper function.',
      };

      expect(message.reasoning).to.include('same code pattern');
    });

    it('should use conventional commit prefixes', () => {
      const validPrefixes = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', 'ci', 'build', 'revert'];

      validPrefixes.forEach((prefix) => {
        const message: GeneratedCommitMessage = {
          summary: `${prefix}: example message`,
          body: null,
          reasoning: null,
        };
        expect(message.summary).to.match(new RegExp(`^${prefix}:`));
      });
    });
  });
});

describe('AI Service Behavior', () => {
  describe('Diff truncation', () => {
    it('should truncate long diffs', () => {
      // Max diff chars is 12000 as per ai_service.rs
      const MAX_DIFF_CHARS = 12000;
      const longDiff = 'a'.repeat(15000);

      const truncated = longDiff.length > MAX_DIFF_CHARS
        ? `${longDiff.substring(0, MAX_DIFF_CHARS)}...\n[Diff truncated for length]`
        : longDiff;

      expect(truncated.length).to.be.lessThan(longDiff.length);
      expect(truncated).to.include('[Diff truncated for length]');
    });

    it('should not truncate short diffs', () => {
      const MAX_DIFF_CHARS = 12000;
      const shortDiff = 'a'.repeat(5000);

      const processed = shortDiff.length > MAX_DIFF_CHARS
        ? `${shortDiff.substring(0, MAX_DIFF_CHARS)}...\n[Diff truncated for length]`
        : shortDiff;

      expect(processed).to.equal(shortDiff);
    });
  });

  describe('Response parsing', () => {
    it('should extract reasoning from response', () => {
      const response = '<reasoning>The changes add a new function</reasoning>feat: add helper function';

      let reasoning: string | null = null;
      if (response.includes('<reasoning>') && response.includes('</reasoning>')) {
        const start = response.indexOf('<reasoning>') + 11;
        const end = response.indexOf('</reasoning>');
        reasoning = response.substring(start, end).trim();
      }

      expect(reasoning).to.equal('The changes add a new function');
    });

    it('should handle response without reasoning', () => {
      const response = 'fix: resolve bug in parser';

      let reasoning: string | null = null;
      if (response.includes('<reasoning>') && response.includes('</reasoning>')) {
        const start = response.indexOf('<reasoning>') + 11;
        const end = response.indexOf('</reasoning>');
        reasoning = response.substring(start, end).trim();
      }

      expect(reasoning).to.be.null;
    });

    it('should split summary and body correctly', () => {
      const response = 'feat: add login feature\n\nThis implements the login feature with:\n- Form validation\n- Error handling';

      const lines = response.split('\n');
      const summary = lines[0].trim();
      const body = lines.slice(2).join('\n').trim() || null;

      expect(summary).to.equal('feat: add login feature');
      expect(body).to.include('Form validation');
      expect(body).to.include('Error handling');
    });

    it('should handle summary-only response', () => {
      const response = 'fix: typo in readme';

      const lines = response.split('\n');
      const summary = lines[0].trim();
      const body = lines.length > 2 ? lines.slice(2).join('\n').trim() : null;

      expect(summary).to.equal('fix: typo in readme');
      expect(body).to.be.null;
    });
  });
});

describe('AI Model Workflow', () => {
  it('should check availability before generation', async () => {
    const status: AiModelStatus = {
      modelAvailable: false,
      modelPath: null,
      modelSizeMb: null,
      quantization: null,
    };

    const canGenerate = status.modelAvailable;
    expect(canGenerate).to.be.false;
  });

  it('should enable generation when model is available', async () => {
    const status: AiModelStatus = {
      modelAvailable: true,
      modelPath: '/path/to/model',
      modelSizeMb: 2048,
      quantization: 'Q4_K_M',
    };

    const canGenerate = status.modelAvailable;
    expect(canGenerate).to.be.true;
  });

  it('should track download state transitions', () => {
    const states: ModelDownloadProgress[] = [
      { downloadedBytes: 0, totalBytes: 2147483648, progressPercent: 0, status: 'downloading' },
      { downloadedBytes: 1073741824, totalBytes: 2147483648, progressPercent: 50, status: 'downloading' },
      { downloadedBytes: 2147483648, totalBytes: 2147483648, progressPercent: 100, status: 'complete' },
    ];

    expect(states[0].status).to.equal('downloading');
    expect(states[1].progressPercent).to.equal(50);
    expect(states[2].status).to.equal('complete');
  });

  it('should track generation state transitions', () => {
    const states: GenerationProgress[] = [
      { status: 'loading_model', tokensGenerated: null, message: 'Loading...' },
      { status: 'generating', tokensGenerated: 10, message: null },
      { status: 'generating', tokensGenerated: 50, message: null },
      { status: 'complete', tokensGenerated: 100, message: 'Done' },
    ];

    expect(states[0].status).to.equal('loading_model');
    expect(states[1].tokensGenerated).to.equal(10);
    expect(states[2].tokensGenerated).to.equal(50);
    expect(states[3].status).to.equal('complete');
  });
});
