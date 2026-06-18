import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import { logger } from '../logger.js';
import { CodebaseAnalysis, TechStack, ProjectStructure } from './types.js';

export class CodebaseAnalyzer {
  private repoPath: string;
  private analysisTimeout: number = 10000; // 10 seconds max

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async analyzeRepository(): Promise<CodebaseAnalysis> {
    try {
      logger.info(`Analyzing codebase at ${this.repoPath}`);

      const startTime = Date.now();

      // Run analysis with timeout protection
      const analysisPromise = this.performAnalysis();
      const timeoutPromise = new Promise<CodebaseAnalysis>((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timeout')), this.analysisTimeout);
      });

      const analysis = await Promise.race([analysisPromise, timeoutPromise]);

      const duration = Date.now() - startTime;
      logger.info(`Codebase analysis completed in ${duration}ms`);

      return analysis;
    } catch (error: any) {
      logger.error('Codebase analysis failed:', error);

      // Return minimal analysis on error
      return this.getMinimalAnalysis();
    }
  }

  private async performAnalysis(): Promise<CodebaseAnalysis> {
    // Run analyses in parallel
    const [techStack, projectStructure, dependencies, estimatedSize] = await Promise.all([
      this.detectTechStack(),
      this.findProjectStructure(),
      this.extractDependencies(),
      this.estimateSize(),
    ]);

    // Find key files
    const keyFiles = await this.identifyKeyFiles(projectStructure);

    return {
      techStack,
      projectStructure,
      keyFiles,
      dependencies,
      estimatedSize,
    };
  }

  private async detectTechStack(): Promise<TechStack> {
    const techStack: TechStack = {
      languages: [],
      frameworks: [],
      buildTools: [],
      testFrameworks: [],
    };

    try {
      // Check for common config files to detect tech
      const checks = [
        { file: 'package.json', lang: 'JavaScript/TypeScript', pm: 'npm' },
        { file: 'pom.xml', lang: 'Java', build: 'Maven' },
        { file: 'build.gradle', lang: 'Java/Kotlin', build: 'Gradle' },
        { file: 'requirements.txt', lang: 'Python', pm: 'pip' },
        { file: 'Pipfile', lang: 'Python', pm: 'pipenv' },
        { file: 'Cargo.toml', lang: 'Rust', build: 'Cargo' },
        { file: 'go.mod', lang: 'Go', build: 'Go modules' },
        { file: 'Gemfile', lang: 'Ruby', pm: 'Bundler' },
        { file: 'composer.json', lang: 'PHP', pm: 'Composer' },
      ];

      for (const check of checks) {
        const filePath = path.join(this.repoPath, check.file);
        try {
          await fs.access(filePath);
          if (check.lang && !techStack.languages.includes(check.lang)) {
            techStack.languages.push(check.lang);
          }
          if (check.build && !techStack.buildTools.includes(check.build)) {
            techStack.buildTools.push(check.build);
          }
          if (check.pm) {
            techStack.packageManager = check.pm;
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      // Detect frameworks from package.json
      if (techStack.languages.includes('JavaScript/TypeScript')) {
        await this.detectJsFrameworks(techStack);
      }

      // Detect test frameworks
      await this.detectTestFrameworks(techStack);
    } catch (error) {
      logger.warn('Failed to detect tech stack:', error);
    }

    return techStack;
  }

  private async detectJsFrameworks(techStack: TechStack): Promise<void> {
    try {
      const packageJsonPath = path.join(this.repoPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      const frameworks = [
        { name: 'React', packages: ['react'] },
        { name: 'Vue.js', packages: ['vue'] },
        { name: 'Angular', packages: ['@angular/core'] },
        { name: 'Next.js', packages: ['next'] },
        { name: 'Express', packages: ['express'] },
        { name: 'NestJS', packages: ['@nestjs/core'] },
        { name: 'Svelte', packages: ['svelte'] },
      ];

      for (const fw of frameworks) {
        if (fw.packages.some((pkg) => dependencies[pkg])) {
          techStack.frameworks.push(fw.name);
        }
      }
    } catch (error) {
      logger.debug('Failed to detect JS frameworks:', error);
    }
  }

  private async detectTestFrameworks(techStack: TechStack): Promise<void> {
    try {
      const testFiles = await fg(['**/*test*', '**/*spec*'], {
        cwd: this.repoPath,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
        onlyFiles: true,
        absolute: false,
      });

      if (testFiles.length > 0) {
        // Check package.json for test frameworks
        try {
          const packageJsonPath = path.join(this.repoPath, 'package.json');
          const content = await fs.readFile(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(content);

          const dependencies = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
          };

          const testFrameworks = [
            { name: 'Jest', packages: ['jest'] },
            { name: 'Mocha', packages: ['mocha'] },
            { name: 'Jasmine', packages: ['jasmine'] },
            { name: 'Vitest', packages: ['vitest'] },
            { name: 'Cypress', packages: ['cypress'] },
            { name: 'Playwright', packages: ['playwright'] },
            { name: 'JUnit', packages: [] }, // Check later for Java
            { name: 'pytest', packages: ['pytest'] },
          ];

          for (const fw of testFrameworks) {
            if (fw.packages.some((pkg) => dependencies[pkg])) {
              techStack.testFrameworks.push(fw.name);
            }
          }
        } catch {
          // Couldn't read package.json, just note tests exist
          techStack.testFrameworks.push('Unknown (tests detected)');
        }
      }
    } catch (error) {
      logger.debug('Failed to detect test frameworks:', error);
    }
  }

  private async findProjectStructure(): Promise<ProjectStructure> {
    const structure: ProjectStructure = {
      rootDirs: [],
      configFiles: [],
      keyFiles: [],
      hasTests: false,
      hasDocs: false,
    };

    try {
      // Get top-level directories
      const entries = await fs.readdir(this.repoPath, { withFileTypes: true });
      structure.rootDirs = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .filter((name) => !['node_modules', 'dist', 'build', 'target'].includes(name));

      // Find config files
      const configPatterns = [
        '*.config.js',
        '*.config.ts',
        '*.json',
        '*.xml',
        '*.yaml',
        '*.yml',
        'Dockerfile*',
        '.env*',
      ];

      const configFiles = await fg(configPatterns, {
        cwd: this.repoPath,
        ignore: ['**/node_modules/**', '**/dist/**'],
        onlyFiles: true,
        absolute: false,
        deep: 1, // Only root level
      });

      structure.configFiles = configFiles;

      // Check for tests
      structure.hasTests = structure.rootDirs.some(
        (dir) => dir === 'test' || dir === 'tests' || dir === '__tests__' || dir === 'spec'
      );

      // Check for docs
      structure.hasDocs = structure.rootDirs.some((dir) => dir === 'docs' || dir === 'doc');

      // Find README
      const readmeFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().startsWith('readme'))
        .map((entry) => entry.name);

      structure.keyFiles.push(...readmeFiles);
    } catch (error) {
      logger.warn('Failed to analyze project structure:', error);
    }

    return structure;
  }

  private async identifyKeyFiles(structure: ProjectStructure): Promise<string[]> {
    const keyFiles: string[] = [];

    try {
      // Add entry points and important config files
      const importantFiles = [
        'package.json',
        'tsconfig.json',
        'webpack.config.js',
        'vite.config.ts',
        'next.config.js',
        'angular.json',
        'pom.xml',
        'build.gradle',
        'Cargo.toml',
        'go.mod',
        'Dockerfile',
        'docker-compose.yml',
        '.env.example',
        'README.md',
      ];

      for (const file of importantFiles) {
        try {
          await fs.access(path.join(this.repoPath, file));
          keyFiles.push(file);
        } catch {
          // File doesn't exist
        }
      }
    } catch (error) {
      logger.warn('Failed to identify key files:', error);
    }

    return keyFiles;
  }

  private async extractDependencies(): Promise<Record<string, any>> {
    const dependencies: Record<string, any> = {};

    try {
      // Try package.json
      const packageJsonPath = path.join(this.repoPath, 'package.json');
      try {
        const content = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content);
        dependencies.npm = {
          dependencies: packageJson.dependencies || {},
          devDependencies: packageJson.devDependencies || {},
        };
      } catch {
        // No package.json
      }

      // Try requirements.txt
      const requirementsPath = path.join(this.repoPath, 'requirements.txt');
      try {
        const content = await fs.readFile(requirementsPath, 'utf-8');
        dependencies.pip = content.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
      } catch {
        // No requirements.txt
      }
    } catch (error) {
      logger.warn('Failed to extract dependencies:', error);
    }

    return dependencies;
  }

  private async estimateSize(): Promise<{ files: number; directories: number }> {
    try {
      const entries = await fg(['**/*'], {
        cwd: this.repoPath,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
        stats: false,
        onlyFiles: false,
      });

      const files = entries.filter((entry) => {
        const fullPath = path.join(this.repoPath, entry);
        try {
          return fs.stat(fullPath).then((stat) => stat.isFile());
        } catch {
          return false;
        }
      });

      return {
        files: entries.length,
        directories: Math.floor(entries.length / 10), // Rough estimate
      };
    } catch (error) {
      logger.warn('Failed to estimate size:', error);
      return { files: 0, directories: 0 };
    }
  }

  private getMinimalAnalysis(): CodebaseAnalysis {
    return {
      techStack: {
        languages: ['Unknown'],
        frameworks: [],
        buildTools: [],
        testFrameworks: [],
      },
      projectStructure: {
        rootDirs: [],
        configFiles: [],
        keyFiles: [],
        hasTests: false,
        hasDocs: false,
      },
      keyFiles: [],
      dependencies: {},
      estimatedSize: {
        files: 0,
        directories: 0,
      },
    };
  }
}
