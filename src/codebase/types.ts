export interface TechStack {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testFrameworks: string[];
  packageManager?: string;
}

export interface ProjectStructure {
  rootDirs: string[];
  configFiles: string[];
  keyFiles: string[];
  hasTests: boolean;
  hasDocs: boolean;
}

export interface CodebaseAnalysis {
  techStack: TechStack;
  projectStructure: ProjectStructure;
  keyFiles: string[];
  dependencies: Record<string, any>;
  estimatedSize: {
    files: number;
    directories: number;
  };
}
