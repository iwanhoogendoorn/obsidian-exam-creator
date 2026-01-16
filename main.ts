import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface ExamCreatorSettings {
    shuffleQuestions: boolean;
    shuffleAnswers: boolean;
    showTimer: boolean;
    defaultTimeLimit: number; // minutes, 0 = no limit
    showImmediateFeedback: boolean;
}

const DEFAULT_SETTINGS: ExamCreatorSettings = {
    shuffleQuestions: false,
    shuffleAnswers: false,
    showTimer: true,
    defaultTimeLimit: 0,
    showImmediateFeedback: false
};

interface QuestionOption {
    letter: string;
    text: string;
}

interface Question {
    id: string;
    text: string;
    imageUrl?: string;
    options: QuestionOption[];
    correctAnswers: string[]; // Array of correct option letters or free text
    type: 'single' | 'multiple' | 'freetext';
    userAnswer?: string[] | string;
}

interface ExamResult {
    totalQuestions: number;
    correctAnswers: number;
    wrongAnswers: number;
    skipped: number;
    percentage: number;
    timeTaken: number; // seconds
    questions: Question[];
}

// ============================================================================
// CONFIRM MODAL
// ============================================================================

class ConfirmModal extends Modal {
    private message: string;
    private onConfirm: () => void;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('exam-confirm-modal');

        contentEl.createEl('p', { text: this.message });

        const buttonContainer = contentEl.createDiv('confirm-buttons');
        
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel', cls: 'exam-btn exam-btn-secondary' });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = buttonContainer.createEl('button', { text: 'Submit', cls: 'exam-btn exam-btn-primary' });
        confirmBtn.onclick = () => {
            this.close();
            this.onConfirm();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ============================================================================
// QUESTION PARSER
// ============================================================================

function parseQuestions(content: string): Question[] {
    const questions: Question[] = [];
    
    // Split by question pattern (Q followed by digits and a dot)
    const questionBlocks = content.split(/(?=Q\d+\.)/);
    
    for (const block of questionBlocks) {
        const trimmed = block.trim();
        if (!trimmed || !trimmed.match(/^Q\d+\./)) continue;
        
        const question = parseQuestionBlock(trimmed);
        if (question) {
            questions.push(question);
        }
    }
    
    return questions;
}

function parseQuestionBlock(block: string): Question | null {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    
    if (lines.length === 0) return null;
    
    // Extract question ID and text
    const firstLine = lines[0];
    const idMatch = firstLine.match(/^Q(\d+)\.\s*(.*)/);
    if (!idMatch) return null;
    
    const id = idMatch[1];
    let questionText = idMatch[2];
    
    // Find options and answer
    const options: QuestionOption[] = [];
    let correctAnswers: string[] = [];
    let imageUrl: string | undefined;
    let answerLineIndex = -1;
    
    // Look for image in the question text or following lines
    const imagePattern = /!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\(([^)]+)\)/;
    
    // Collect question text (might span multiple lines until we hit options or answer)
    const questionTextLines: string[] = [questionText];
    let i = 1;
    
    // Continue reading question text until we hit an option or answer
    while (i < lines.length) {
        const line = lines[i];
        
        // Check for image
        const imgMatch = line.match(imagePattern);
        if (imgMatch) {
            imageUrl = imgMatch[1] || imgMatch[3];
            i++;
            continue;
        }
        
        // Check if it's an option line
        if (line.match(/^[A-Z]\.\s+/)) {
            break;
        }
        
        // Check if it's the answer line
        if (line.match(/^Answer:/i)) {
            break;
        }
        
        // Check for image in question text
        const textImgMatch = line.match(imagePattern);
        if (textImgMatch) {
            imageUrl = textImgMatch[1] || textImgMatch[3];
        } else if (line.toLowerCase().includes('with image support')) {
            // Skip this meta line
        } else {
            questionTextLines.push(line);
        }
        i++;
    }
    
    questionText = questionTextLines.join(' ').trim();
    
    // Also check original question text for embedded images
    const textImgMatch = questionText.match(imagePattern);
    if (textImgMatch && !imageUrl) {
        imageUrl = textImgMatch[1] || textImgMatch[3];
        questionText = questionText.replace(imagePattern, '').trim();
    }
    
    // Parse options
    while (i < lines.length) {
        const line = lines[i];
        
        // Check for answer line
        if (line.match(/^Answer:/i)) {
            answerLineIndex = i;
            break;
        }
        
        // Parse option
        const optionMatch = line.match(/^([A-Z])\.\s+(.*)/);
        if (optionMatch) {
            options.push({
                letter: optionMatch[1],
                text: optionMatch[2]
            });
        }
        
        i++;
    }
    
    // Parse answer
    if (answerLineIndex >= 0) {
        const answerLine = lines[answerLineIndex];
        const answerMatch = answerLine.match(/^Answer:\s*(.*)/i);
        if (answerMatch) {
            const answerText = answerMatch[1].trim();
            
            // Check if it's multiple choice answers (comma separated letters)
            if (answerText.match(/^[A-Z](\s*,\s*[A-Z])*$/)) {
                correctAnswers = answerText.split(/\s*,\s*/).map(a => a.trim().toUpperCase());
            } else if (answerText.match(/^[A-Z]$/)) {
                correctAnswers = [answerText.toUpperCase()];
            } else {
                // Free text answer
                correctAnswers = [answerText];
            }
        }
    }
    
    // Determine question type
    let type: 'single' | 'multiple' | 'freetext';
    if (options.length === 0) {
        type = 'freetext';
    } else if (correctAnswers.length > 1 && correctAnswers.every(a => a.match(/^[A-Z]$/))) {
        type = 'multiple';
    } else {
        type = 'single';
    }
    
    return {
        id,
        text: questionText,
        imageUrl,
        options,
        correctAnswers,
        type
    };
}

function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ============================================================================
// EXAM MODAL
// ============================================================================

class ExamModal extends Modal {
    private questions: Question[];
    private currentIndex: number = 0;
    private settings: ExamCreatorSettings;
    private startTime: number;
    private timerInterval: number | null = null;
    private examContainer: HTMLElement | null = null;
    private sourcePath: string;
    private plugin: ExamCreatorPlugin;
    
    constructor(app: App, questions: Question[], settings: ExamCreatorSettings, sourcePath: string, plugin: ExamCreatorPlugin) {
        super(app);
        this.settings = settings;
        this.sourcePath = sourcePath;
        this.plugin = plugin;
        
        // Prepare questions
        this.questions = settings.shuffleQuestions ? shuffleArray(questions) : [...questions];
        
        if (settings.shuffleAnswers) {
            this.questions = this.questions.map(q => ({
                ...q,
                options: shuffleArray(q.options)
            }));
        }
        
        this.startTime = Date.now();
    }
    
    onOpen() {
        const { contentEl, modalEl } = this;
        
        // Add container class for large modal
        modalEl.addClass('exam-creator-modal-container');
        
        contentEl.empty();
        contentEl.addClass('exam-creator-modal');
        
        // Create header
        const header = contentEl.createDiv('exam-header');
        
        const headerLeft = header.createDiv('exam-header-left');
        headerLeft.createDiv({ cls: 'exam-title', text: 'Exam in progress' });
        
        const progressInfo = headerLeft.createDiv('exam-progress');
        progressInfo.createSpan({ text: 'Question ' });
        progressInfo.createSpan({ cls: 'current-question', text: '1' });
        progressInfo.createSpan({ text: ` of ${this.questions.length}` });
        
        const headerRight = header.createDiv('exam-header-right');
        
        if (this.settings.showTimer) {
            const timerEl = headerRight.createDiv('exam-timer');
            timerEl.createSpan({ cls: 'timer-icon', text: '⏱️' });
            timerEl.createSpan({ cls: 'timer-value', text: '00:00' });
            
            this.timerInterval = window.setInterval(() => {
                const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
                const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                const timerValue = timerEl.querySelector('.timer-value');
                if (timerValue) {
                    timerValue.textContent = `${minutes}:${seconds}`;
                }
            }, 1000);
        }
        
        // Progress bar
        const progressBar = contentEl.createDiv('exam-progress-bar');
        progressBar.createDiv('exam-progress-fill');
        
        // Main content area with sidebar
        const mainContent = contentEl.createDiv('exam-main-content');
        
        // Sidebar with question grid
        const sidebar = mainContent.createDiv('exam-sidebar');
        const sidebarHeader = sidebar.createDiv('sidebar-header');
        sidebarHeader.createEl('h3', { text: 'Questions' });
        
        // Status summary
        const statusSummary = sidebar.createDiv('status-summary');
        const answeredStatus = statusSummary.createDiv('status-item');
        answeredStatus.createDiv({ cls: 'status-dot answered' });
        answeredStatus.createSpan({ cls: 'status-count answered-count', text: '0' });
        answeredStatus.createSpan({ text: ' answered' });
        
        const remainingStatus = statusSummary.createDiv('status-item');
        remainingStatus.createDiv({ cls: 'status-dot remaining' });
        remainingStatus.createSpan({ cls: 'status-count remaining-count', text: this.questions.length.toString() });
        remainingStatus.createSpan({ text: ' remaining' });
        
        // Question grid
        const questionGrid = sidebar.createDiv('question-grid');
        this.questions.forEach((_, idx) => {
            const gridItem = questionGrid.createDiv('grid-item');
            gridItem.textContent = (idx + 1).toString();
            gridItem.onclick = () => this.goToQuestion(idx);
        });
        
        // Question container
        this.examContainer = mainContent.createDiv('exam-container');
        
        // Bottom navigation
        const bottomNav = contentEl.createDiv('exam-bottom-nav');
        
        const navLeft = bottomNav.createDiv('nav-left');
        const prevBtn = navLeft.createEl('button', { text: '← Previous', cls: 'exam-btn exam-btn-secondary' });
        prevBtn.onclick = () => this.goToPrevious();
        
        const navCenter = bottomNav.createDiv('nav-center');
        const jumpContainer = navCenter.createDiv('jump-container');
        jumpContainer.createSpan({ cls: 'jump-label', text: 'Go to:' });
        const jumpInput = jumpContainer.createEl('input', { 
            type: 'number', 
            cls: 'jump-input',
            attr: { min: '1', max: this.questions.length.toString() }
        }) as HTMLInputElement;
        jumpInput.value = '1';
        jumpInput.onchange = () => {
            const num = parseInt(jumpInput.value);
            if (num >= 1 && num <= this.questions.length) {
                this.goToQuestion(num - 1);
            }
        };
        
        const navRight = bottomNav.createDiv('nav-right');
        const nextBtn = navRight.createEl('button', { text: 'Next →', cls: 'exam-btn exam-btn-secondary' });
        nextBtn.onclick = () => this.goToNext();
        
        // Submit footer
        const submitFooter = contentEl.createDiv('exam-submit-footer');
        const submitBtn = submitFooter.createEl('button', { text: 'Submit exam', cls: 'exam-btn exam-btn-primary exam-btn-large' });
        submitBtn.onclick = () => this.submitExam();
        
        // Render first question
        this.renderQuestion();
    }
    
    private renderQuestion() {
        if (!this.examContainer) return;
        
        this.examContainer.empty();
        const question = this.questions[this.currentIndex];
        
        // Update progress
        const currentQuestionEl = this.contentEl.querySelector('.current-question');
        if (currentQuestionEl) {
            currentQuestionEl.textContent = (this.currentIndex + 1).toString();
        }
        
        // Update jump input
        const jumpInput = this.contentEl.querySelector('.jump-input') as HTMLInputElement;
        if (jumpInput) {
            jumpInput.value = (this.currentIndex + 1).toString();
        }
        
        // Update progress bar
        const progressFill = this.contentEl.querySelector('.exam-progress-fill') as HTMLElement;
        if (progressFill) {
            const percentage = ((this.currentIndex + 1) / this.questions.length) * 100;
            progressFill.style.width = `${percentage}%`;
        }
        
        // Update grid items
        const gridItems = this.contentEl.querySelectorAll('.grid-item');
        gridItems.forEach((item, idx) => {
            item.removeClass('active', 'answered');
            if (idx === this.currentIndex) {
                item.addClass('active');
            }
            const q = this.questions[idx];
            if (q.userAnswer !== undefined) {
                const answer = q.userAnswer;
                if (Array.isArray(answer) ? answer.length > 0 : answer !== '') {
                    item.addClass('answered');
                }
            }
        });
        
        // Update status counts
        const answeredCount = this.questions.filter(q => {
            if (!q.userAnswer) return false;
            return Array.isArray(q.userAnswer) ? q.userAnswer.length > 0 : q.userAnswer !== '';
        }).length;
        
        const answeredCountEl = this.contentEl.querySelector('.answered-count');
        const remainingCountEl = this.contentEl.querySelector('.remaining-count');
        if (answeredCountEl) answeredCountEl.textContent = answeredCount.toString();
        if (remainingCountEl) remainingCountEl.textContent = (this.questions.length - answeredCount).toString();
        
        // Question card wrapper
        const wrapper = this.examContainer.createDiv('question-card-wrapper');
        const card = wrapper.createDiv('question-card');
        
        // Question header
        const questionHeader = card.createDiv('question-header');
        questionHeader.createDiv({ cls: 'question-number', text: `Question ${this.currentIndex + 1} of ${this.questions.length}` });
        
        // Question type badge
        const badge = questionHeader.createDiv('question-type-badge');
        if (question.type === 'multiple') {
            badge.textContent = 'Multiple choice (select all that apply)';
            badge.addClass('badge-multiple');
        } else if (question.type === 'freetext') {
            badge.textContent = 'Free text';
            badge.addClass('badge-freetext');
        } else {
            badge.textContent = 'Single choice';
            badge.addClass('badge-single');
        }
        
        // Question body
        const questionBody = card.createDiv('question-body');
        
        // Question text
        const questionTextEl = questionBody.createDiv('question-text');
        questionTextEl.createEl('span', { cls: 'question-id', text: `Q${question.id}. ` });
        questionTextEl.createSpan({ text: question.text });
        
        // Instruction for multiple choice
        if (question.type === 'multiple') {
            questionBody.createDiv({ cls: 'question-instruction', text: 'Select all answers that apply' });
        }
        
        // Image if present
        if (question.imageUrl) {
            const imageContainer = questionBody.createDiv('question-image-container');
            const img = imageContainer.createEl('img', { cls: 'question-image' });
            
            const imagePath = question.imageUrl;
            const file = this.app.metadataCache.getFirstLinkpathDest(imagePath, this.sourcePath);
            if (file) {
                img.src = this.app.vault.getResourcePath(file);
            } else {
                img.src = imagePath;
            }
            img.alt = 'Question image';
        }
        
        // Answer section
        const answerSection = questionBody.createDiv('answer-section');
        
        if (question.type === 'freetext') {
            const input = answerSection.createEl('textarea', {
                cls: 'freetext-input',
                attr: { placeholder: 'Type your answer here...' }
            });
            input.value = (question.userAnswer as string) || '';
            input.oninput = () => {
                question.userAnswer = input.value;
                this.updateStatus();
            };
        } else {
            const optionsContainer = answerSection.createDiv('options-container');
            
            question.options.forEach(option => {
                const optionEl = optionsContainer.createDiv('option-item');
                
                const inputType = question.type === 'multiple' ? 'checkbox' : 'radio';
                const input = optionEl.createEl('input', {
                    type: inputType,
                    attr: {
                        name: `question-${question.id}`,
                        value: option.letter,
                        id: `option-${question.id}-${option.letter}`
                    }
                });
                
                if (question.userAnswer) {
                    const answers = Array.isArray(question.userAnswer) ? question.userAnswer : [question.userAnswer];
                    if (answers.includes(option.letter)) {
                        input.checked = true;
                        optionEl.addClass('selected');
                    }
                }
                
                const label = optionEl.createEl('label', {
                    attr: { for: `option-${question.id}-${option.letter}` }
                });
                const optionContent = label.createDiv('option-content');
                optionContent.createSpan({ cls: 'option-letter', text: option.letter });
                optionContent.createSpan({ cls: 'option-text', text: option.text });
                
                input.onchange = () => {
                    if (question.type === 'multiple') {
                        const checked = optionsContainer.querySelectorAll('input:checked');
                        question.userAnswer = Array.from(checked).map(c => (c as HTMLInputElement).value);
                    } else {
                        question.userAnswer = [option.letter];
                    }
                    
                    optionsContainer.querySelectorAll('.option-item').forEach(item => {
                        item.removeClass('selected');
                    });
                    optionsContainer.querySelectorAll('input:checked').forEach(checked => {
                        checked.closest('.option-item')?.addClass('selected');
                    });
                    
                    this.updateStatus();
                };
            });
        }
    }
    
    private updateStatus() {
        const gridItems = this.contentEl.querySelectorAll('.grid-item');
        gridItems.forEach((item, idx) => {
            item.removeClass('answered');
            const q = this.questions[idx];
            if (q.userAnswer !== undefined) {
                const answer = q.userAnswer;
                if (Array.isArray(answer) ? answer.length > 0 : answer !== '') {
                    item.addClass('answered');
                }
            }
        });
        
        const answeredCount = this.questions.filter(q => {
            if (!q.userAnswer) return false;
            return Array.isArray(q.userAnswer) ? q.userAnswer.length > 0 : q.userAnswer !== '';
        }).length;
        
        const answeredCountEl = this.contentEl.querySelector('.answered-count');
        const remainingCountEl = this.contentEl.querySelector('.remaining-count');
        if (answeredCountEl) answeredCountEl.textContent = answeredCount.toString();
        if (remainingCountEl) remainingCountEl.textContent = (this.questions.length - answeredCount).toString();
    }
    
    private goToPrevious() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.renderQuestion();
        }
    }
    
    private goToNext() {
        if (this.currentIndex < this.questions.length - 1) {
            this.currentIndex++;
            this.renderQuestion();
        }
    }
    
    private goToQuestion(index: number) {
        this.currentIndex = index;
        this.renderQuestion();
    }
    
    private submitExam() {
        const unanswered = this.questions.filter(q => 
            !q.userAnswer || 
            (Array.isArray(q.userAnswer) && q.userAnswer.length === 0) ||
            q.userAnswer === ''
        ).length;
        
        if (unanswered > 0) {
            new ConfirmModal(
                this.app,
                `You have ${unanswered} unanswered question(s). Are you sure you want to submit?`,
                () => this.finalizeSubmission()
            ).open();
            return;
        }
        
        this.finalizeSubmission();
    }
    
    private finalizeSubmission() {
        const timeTaken = Math.floor((Date.now() - this.startTime) / 1000);
        
        let correct = 0;
        let wrong = 0;
        let skipped = 0;
        
        this.questions.forEach(q => {
            if (!q.userAnswer || 
                (Array.isArray(q.userAnswer) && q.userAnswer.length === 0) ||
                q.userAnswer === '') {
                skipped++;
                return;
            }
            
            if (q.type === 'freetext') {
                const userAnswerLower = (q.userAnswer as string).toLowerCase().trim();
                const correctAnswerLower = q.correctAnswers[0].toLowerCase().trim();
                if (userAnswerLower === correctAnswerLower) {
                    correct++;
                } else {
                    wrong++;
                }
            } else {
                const userAnswers = Array.isArray(q.userAnswer) ? q.userAnswer : [q.userAnswer];
                const sortedUser = [...userAnswers].sort().join(',');
                const sortedCorrect = [...q.correctAnswers].sort().join(',');
                
                if (sortedUser === sortedCorrect) {
                    correct++;
                } else {
                    wrong++;
                }
            }
        });
        
        const result: ExamResult = {
            totalQuestions: this.questions.length,
            correctAnswers: correct,
            wrongAnswers: wrong,
            skipped,
            percentage: Math.round((correct / this.questions.length) * 100),
            timeTaken,
            questions: this.questions
        };
        
        this.close();
        new ResultsModal(this.app, result, this.sourcePath, this.plugin).open();
    }
    
    onClose() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
        this.contentEl.empty();
    }
}

// ============================================================================
// RESULTS MODAL
// ============================================================================

class ResultsModal extends Modal {
    private result: ExamResult;
    private sourcePath: string;
    private plugin: ExamCreatorPlugin;
    
    constructor(app: App, result: ExamResult, sourcePath: string, plugin: ExamCreatorPlugin) {
        super(app);
        this.result = result;
        this.sourcePath = sourcePath;
        this.plugin = plugin;
    }
    
    onOpen() {
        const { contentEl, modalEl } = this;
        
        modalEl.addClass('exam-results-modal-container');
        
        contentEl.empty();
        contentEl.addClass('exam-results-modal');
        
        // Header
        const header = contentEl.createDiv('results-header');
        header.createEl('h2', { text: 'Exam results' });
        const subtitle = `${this.result.totalQuestions} questions completed`;
        header.createDiv({ cls: 'results-subtitle', text: subtitle });
        
        // Score section
        const scoreSection = contentEl.createDiv('score-section');
        
        const scoreCircle = scoreSection.createDiv('score-circle');
        const percentage = this.result.percentage;
        scoreCircle.addClass(percentage >= 70 ? 'pass' : 'fail');
        scoreCircle.createSpan({ cls: 'score-value', text: `${percentage}%` });
        scoreCircle.createSpan({ cls: 'score-label', text: percentage >= 70 ? 'PASSED' : 'FAILED' });
        
        // Stats grid
        const statsGrid = scoreSection.createDiv('stats-grid');
        
        const statItems = [
            { label: 'Total', value: this.result.totalQuestions.toString(), cls: 'stat-total', icon: '📋' },
            { label: 'Correct', value: this.result.correctAnswers.toString(), cls: 'stat-correct', icon: '✓' },
            { label: 'Wrong', value: this.result.wrongAnswers.toString(), cls: 'stat-wrong', icon: '✗' },
            { label: 'Skipped', value: this.result.skipped.toString(), cls: 'stat-skipped', icon: '○' }
        ];
        
        statItems.forEach(item => {
            const stat = statsGrid.createDiv(`stat-card ${item.cls}`);
            stat.createDiv({ cls: 'stat-icon', text: item.icon });
            stat.createDiv({ cls: 'stat-value', text: item.value });
            stat.createDiv({ cls: 'stat-label', text: item.label });
        });
        
        // Time taken
        const minutes = Math.floor(this.result.timeTaken / 60);
        const seconds = this.result.timeTaken % 60;
        const timeText = `⏱️ Time taken: ${minutes}m ${seconds}s`;
        scoreSection.createDiv({ cls: 'time-taken', text: timeText });
        
        // Actions
        const actionsSection = contentEl.createDiv('results-actions');
        
        // Review button
        const reviewBtn = actionsSection.createEl('button', { 
            text: '📖 Review all answers', 
            cls: 'exam-btn exam-btn-primary exam-btn-large' 
        });
        reviewBtn.style.width = '100%';
        reviewBtn.onclick = () => {
            this.close();
            new FullReviewModal(this.app, this.result, this.sourcePath, this.plugin).open();
        };
        
        // Save wrong answers button
        if (this.result.wrongAnswers > 0 || this.result.skipped > 0) {
            const saveBtn = actionsSection.createEl('button', { 
                text: '💾 Save wrong answers to file', 
                cls: 'exam-btn exam-btn-warning exam-btn-large' 
            });
            saveBtn.style.width = '100%';
            saveBtn.onclick = () => {
                void this.saveWrongAnswersToFile();
            };
        }
        
        // Close button
        const closeBtn = actionsSection.createEl('button', { 
            text: 'Close', 
            cls: 'exam-btn exam-btn-secondary exam-btn-large' 
        });
        closeBtn.style.width = '100%';
        closeBtn.onclick = () => this.close();
    }
    
    private async saveWrongAnswersToFile() {
        const wrongQuestions = this.result.questions.filter(q => {
            if (!q.userAnswer || 
                (Array.isArray(q.userAnswer) && q.userAnswer.length === 0) ||
                q.userAnswer === '') {
                return true; // Skipped
            }
            
            if (q.type === 'freetext') {
                const userAnswerLower = (q.userAnswer as string).toLowerCase().trim();
                const correctAnswerLower = q.correctAnswers[0].toLowerCase().trim();
                return userAnswerLower !== correctAnswerLower;
            } else {
                const userAnswers = Array.isArray(q.userAnswer) ? q.userAnswer : [q.userAnswer];
                const sortedUser = [...userAnswers].sort().join(',');
                const sortedCorrect = [...q.correctAnswers].sort().join(',');
                return sortedUser !== sortedCorrect;
            }
        });
        
        if (wrongQuestions.length === 0) {
            new Notice('No wrong answers to save!');
            return;
        }
        
        // Generate markdown content
        let content = `# Wrong/Skipped Questions - Review\n\n`;
        content += `Generated: ${new Date().toLocaleString()}\n`;
        content += `Score: ${this.result.percentage}% (${this.result.correctAnswers}/${this.result.totalQuestions})\n\n`;
        content += `---\n\n`;
        
        wrongQuestions.forEach((q, idx) => {
            content += `Q${q.id}. ${q.text}\n`;
            
            if (q.options.length > 0) {
                q.options.forEach(opt => {
                    content += `${opt.letter}. ${opt.text}\n`;
                });
            }
            
            content += `Answer: ${q.correctAnswers.join(', ')}\n`;
            
            // Add user's wrong answer for reference
            if (q.userAnswer) {
                const userAns = Array.isArray(q.userAnswer) ? q.userAnswer.join(', ') : q.userAnswer;
                if (userAns) {
                    content += `Your answer: ${userAns}\n`;
                }
            } else {
                content += `Your answer: (skipped)\n`;
            }
            
            content += `\n`;
        });
        
        // Create file
        const timestamp = new Date().toISOString().slice(0, 10);
        const basePath = this.sourcePath.replace(/\.md$/, '');
        const fileName = `${basePath} - Wrong Answers ${timestamp}.md`;
        
        try {
            const existingFile = this.app.vault.getAbstractFileByPath(fileName);
            if (existingFile instanceof TFile) {
                await this.app.vault.modify(existingFile, content);
            } else {
                await this.app.vault.create(fileName, content);
            }
            new Notice(`Saved ${wrongQuestions.length} wrong/skipped questions to:\n${fileName}`);
        } catch (error) {
            new Notice('Failed to save file. Please try again.');
            console.error('Error saving wrong answers:', error);
        }
    }
    
    onClose() {
        this.contentEl.empty();
    }
}

// ============================================================================
// FULL REVIEW MODAL
// ============================================================================

class FullReviewModal extends Modal {
    private result: ExamResult;
    private sourcePath: string;
    private plugin: ExamCreatorPlugin;
    private currentFilter: 'all' | 'correct' | 'wrong' | 'skipped' = 'all';
    private currentQuestionIndex: number = 0;
    private filteredQuestions: { question: Question; originalIndex: number; status: 'correct' | 'wrong' | 'skipped' }[] = [];
    private detailArea: HTMLElement | null = null;
    
    constructor(app: App, result: ExamResult, sourcePath: string, plugin: ExamCreatorPlugin) {
        super(app);
        this.result = result;
        this.sourcePath = sourcePath;
        this.plugin = plugin;
    }
    
    onOpen() {
        const { contentEl, modalEl } = this;
        
        modalEl.addClass('full-review-modal-container');
        
        contentEl.empty();
        contentEl.addClass('full-review-modal');
        
        // Header
        const header = contentEl.createDiv('review-modal-header');
        header.createEl('h2', { text: 'Review answers' });
        
        const headerStats = header.createDiv('header-stats');
        headerStats.createDiv({ cls: 'header-stat correct', text: `✓ ${this.result.correctAnswers}` });
        headerStats.createDiv({ cls: 'header-stat wrong', text: `✗ ${this.result.wrongAnswers}` });
        headerStats.createDiv({ cls: 'header-stat skipped', text: `○ ${this.result.skipped}` });
        
        const closeBtn = header.createEl('button', { cls: 'review-close-btn', text: '✕' });
        closeBtn.onclick = () => this.close();
        
        // Main layout
        const mainLayout = contentEl.createDiv('review-main-layout');
        
        // Sidebar
        const sidebar = mainLayout.createDiv('review-sidebar');
        
        // Filter buttons
        const filterContainer = sidebar.createDiv('review-filter-container');
        
        const counts = this.getCounts();
        const filters = [
            { id: 'all', label: 'All', count: this.result.totalQuestions },
            { id: 'correct', label: 'Correct', count: counts.correct },
            { id: 'wrong', label: 'Wrong', count: counts.wrong },
            { id: 'skipped', label: 'Skipped', count: counts.skipped }
        ];
        
        filters.forEach(filter => {
            const btn = filterContainer.createEl('button', { cls: 'sidebar-filter-btn' });
            btn.createSpan({ text: filter.label });
            btn.createSpan({ cls: 'filter-count', text: filter.count.toString() });
            if (filter.id === 'all') btn.addClass('active');
            
            btn.onclick = () => {
                filterContainer.querySelectorAll('.sidebar-filter-btn').forEach(b => b.removeClass('active'));
                btn.addClass('active');
                this.currentFilter = filter.id as 'all' | 'correct' | 'wrong' | 'skipped';
                this.currentQuestionIndex = 0;
                this.updateQuestionList();
                this.renderCurrentQuestion();
            };
        });
        
        // Question list
        sidebar.createDiv('review-question-list');
        
        // Detail area
        this.detailArea = mainLayout.createDiv('review-detail-area');
        
        // Navigation bar
        const navBar = contentEl.createDiv('review-nav-bar');
        
        const navLeft = navBar.createDiv('nav-left');
        const prevBtn = navLeft.createEl('button', { text: '← Previous', cls: 'exam-btn exam-btn-secondary' });
        prevBtn.onclick = () => this.goToPrevious();
        
        navBar.createDiv({ cls: 'nav-info review-nav-info' });
        
        const navRight = navBar.createDiv('nav-right');
        const nextBtn = navRight.createEl('button', { text: 'Next →', cls: 'exam-btn exam-btn-secondary' });
        nextBtn.onclick = () => this.goToNext();
        
        // Initialize
        this.updateQuestionList();
        this.renderCurrentQuestion();
    }
    
    private getCounts() {
        let correct = 0;
        let wrong = 0;
        let skipped = 0;
        
        this.result.questions.forEach(q => {
            const status = this.getQuestionStatus(q);
            if (status === 'correct') correct++;
            else if (status === 'wrong') wrong++;
            else skipped++;
        });
        
        return { correct, wrong, skipped };
    }
    
    private getQuestionStatus(q: Question): 'correct' | 'wrong' | 'skipped' {
        if (!q.userAnswer || 
            (Array.isArray(q.userAnswer) && q.userAnswer.length === 0) ||
            q.userAnswer === '') {
            return 'skipped';
        }
        
        if (q.type === 'freetext') {
            const userAnswerLower = (q.userAnswer as string).toLowerCase().trim();
            const correctAnswerLower = q.correctAnswers[0].toLowerCase().trim();
            return userAnswerLower === correctAnswerLower ? 'correct' : 'wrong';
        } else {
            const userAnswers = Array.isArray(q.userAnswer) ? q.userAnswer : [q.userAnswer];
            const sortedUser = [...userAnswers].sort().join(',');
            const sortedCorrect = [...q.correctAnswers].sort().join(',');
            return sortedUser === sortedCorrect ? 'correct' : 'wrong';
        }
    }
    
    private updateQuestionList() {
        this.filteredQuestions = [];
        
        this.result.questions.forEach((q, idx) => {
            const status = this.getQuestionStatus(q);
            if (this.currentFilter === 'all' || this.currentFilter === status) {
                this.filteredQuestions.push({ question: q, originalIndex: idx, status });
            }
        });
        
        // Update sidebar list
        const listContainer = this.contentEl.querySelector('.review-question-list');
        if (!listContainer) return;
        
        listContainer.empty();
        
        this.filteredQuestions.forEach((item, idx) => {
            const listItem = listContainer.createDiv(`question-list-item ${item.status}`);
            if (idx === this.currentQuestionIndex) listItem.addClass('active');
            
            const statusIcon = listItem.createDiv('list-status-icon');
            statusIcon.textContent = item.status === 'correct' ? '✓' : item.status === 'wrong' ? '✗' : '○';
            
            const info = listItem.createDiv('list-question-info');
            info.createDiv({ cls: 'list-question-num', text: `Question ${item.originalIndex + 1}` });
            info.createDiv({ cls: 'list-question-preview', text: item.question.text.substring(0, 50) + '...' });
            
            listItem.onclick = () => {
                this.currentQuestionIndex = idx;
                this.updateQuestionList();
                this.renderCurrentQuestion();
            };
        });
    }
    
    private renderCurrentQuestion() {
        if (!this.detailArea) return;
        
        this.detailArea.empty();
        
        // Update nav info
        const navInfo = this.contentEl.querySelector('.review-nav-info');
        if (navInfo) {
            navInfo.textContent = `${this.currentQuestionIndex + 1} of ${this.filteredQuestions.length}`;
        }
        
        if (this.filteredQuestions.length === 0) {
            this.detailArea.createDiv({ cls: 'no-questions-message', text: 'No questions match this filter.' });
            return;
        }
        
        const item = this.filteredQuestions[this.currentQuestionIndex];
        const q = item.question;
        
        // Question card
        const card = this.detailArea.createDiv(`review-question-card ${item.status}`);
        
        // Status banner
        const banner = card.createDiv(`status-banner ${item.status}`);
        banner.textContent = item.status === 'correct' ? '✓ Correct' : item.status === 'wrong' ? '✗ Incorrect' : '○ Skipped';
        
        // Question content
        const content = card.createDiv('review-question-content');
        
        // Question text
        const questionText = content.createDiv('review-full-question-text');
        questionText.createEl('strong', { text: `Q${q.id}. ` });
        questionText.createSpan({ text: q.text });
        
        // Image if present
        if (q.imageUrl) {
            const imageContainer = content.createDiv('review-full-image-container');
            const img = imageContainer.createEl('img', { cls: 'review-full-image' });
            const file = this.app.metadataCache.getFirstLinkpathDest(q.imageUrl, this.sourcePath);
            if (file) {
                img.src = this.app.vault.getResourcePath(file);
            } else {
                img.src = q.imageUrl;
            }
        }
        
        // Options or free text
        if (q.options.length > 0) {
            const optionsContainer = content.createDiv('review-full-options');
            
            q.options.forEach(opt => {
                const optEl = optionsContainer.createDiv('review-full-option');
                
                const isUserAnswer = Array.isArray(q.userAnswer) ? 
                    q.userAnswer.includes(opt.letter) : 
                    q.userAnswer === opt.letter;
                const isCorrectAnswer = q.correctAnswers.includes(opt.letter);
                
                if (isCorrectAnswer) {
                    optEl.addClass('correct-answer');
                }
                if (isUserAnswer && !isCorrectAnswer) {
                    optEl.addClass('wrong-answer');
                }
                if (isUserAnswer && isCorrectAnswer) {
                    optEl.addClass('user-correct');
                }
                
                const optionMain = optEl.createDiv('option-main');
                optionMain.createSpan({ cls: 'option-letter', text: opt.letter });
                optionMain.createSpan({ cls: 'option-text', text: opt.text });
                
                const markers = optEl.createDiv('option-markers');
                if (isCorrectAnswer) {
                    markers.createSpan({ cls: 'marker correct-marker', text: 'Correct' });
                }
                if (isUserAnswer && !isCorrectAnswer) {
                    markers.createSpan({ cls: 'marker wrong-marker', text: 'Your answer' });
                }
            });
        } else {
            // Free text review
            const ftContainer = content.createDiv('review-freetext-container');
            
            const userRow = ftContainer.createDiv('freetext-row');
            userRow.createSpan({ cls: 'freetext-label', text: 'Your answer:' });
            const userValue = userRow.createSpan({ cls: 'freetext-value' });
            const userAnswerText = typeof q.userAnswer === 'string' && q.userAnswer ? q.userAnswer : '(not answered)';
            userValue.textContent = userAnswerText;
            if (item.status !== 'correct') userValue.addClass('user');
            
            const correctRow = ftContainer.createDiv('freetext-row');
            correctRow.createSpan({ cls: 'freetext-label', text: 'Correct answer:' });
            correctRow.createSpan({ cls: 'freetext-value correct', text: q.correctAnswers[0] });
        }
    }
    
    private goToPrevious() {
        if (this.currentQuestionIndex > 0) {
            this.currentQuestionIndex--;
            this.updateQuestionList();
            this.renderCurrentQuestion();
        }
    }
    
    private goToNext() {
        if (this.currentQuestionIndex < this.filteredQuestions.length - 1) {
            this.currentQuestionIndex++;
            this.updateQuestionList();
            this.renderCurrentQuestion();
        }
    }
    
    onClose() {
        this.contentEl.empty();
    }
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

class ExamCreatorSettingTab extends PluginSettingTab {
    plugin: ExamCreatorPlugin;

    constructor(app: App, plugin: ExamCreatorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Exam creator settings')
            .setHeading();

        new Setting(containerEl)
            .setName('Shuffle questions')
            .setDesc('Randomize the order of questions in each exam')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.shuffleQuestions)
                .onChange(async (value) => {
                    this.plugin.settings.shuffleQuestions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Shuffle answers')
            .setDesc('Randomize the order of answer options for each question')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.shuffleAnswers)
                .onChange(async (value) => {
                    this.plugin.settings.shuffleAnswers = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show timer')
            .setDesc('Display a timer during the exam')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTimer)
                .onChange(async (value) => {
                    this.plugin.settings.showTimer = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default time limit')
            .setDesc('Default time limit in minutes (0 = no limit)')
            .addText(text => text
                .setValue(this.plugin.settings.defaultTimeLimit.toString())
                .onChange(async (value) => {
                    const num = parseInt(value) || 0;
                    this.plugin.settings.defaultTimeLimit = num;
                    await this.plugin.saveSettings();
                }));
    }
}

// ============================================================================
// MAIN PLUGIN
// ============================================================================

export default class ExamCreatorPlugin extends Plugin {
    settings: ExamCreatorSettings = DEFAULT_SETTINGS;

    async onload() {
        await this.loadSettings();

        // Add ribbon icon
        this.addRibbonIcon('check-square', 'Start exam', () => {
            void this.startExamFromCurrentFile();
        });

        // Add command to start exam
        this.addCommand({
            id: 'start-exam',
            name: 'Start exam from current note',
            editorCallback: () => {
                void this.startExamFromCurrentFile();
            }
        });

        // Add command to preview questions
        this.addCommand({
            id: 'preview-questions',
            name: 'Preview questions in current note',
            editorCallback: () => {
                void this.previewQuestions();
            }
        });

        // Add settings tab
        this.addSettingTab(new ExamCreatorSettingTab(this.app, this));
    }

    onunload() {
        // Cleanup if needed
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private async startExamFromCurrentFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file. Please open a note with exam questions.');
            return;
        }

        const content = await this.app.vault.read(activeFile);
        const questions = parseQuestions(content);

        if (questions.length === 0) {
            new Notice('No questions found in this note. Make sure your questions follow the format:\n\nQ001. Question text\nA. Option\nB. Option\nAnswer: A');
            return;
        }

        new Notice(`Found ${questions.length} questions. Starting exam...`);
        new ExamModal(this.app, questions, this.settings, activeFile.path, this).open();
    }

    private async previewQuestions() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file.');
            return;
        }

        const content = await this.app.vault.read(activeFile);
        const questions = parseQuestions(content);

        if (questions.length === 0) {
            new Notice('No questions found.');
            return;
        }

        // Show preview modal
        const modal = new Modal(this.app);
        modal.contentEl.addClass('exam-preview-modal');
        modal.contentEl.createEl('h2', { text: `Preview: ${questions.length} questions found` });
        
        const list = modal.contentEl.createDiv('preview-list');
        questions.forEach((q) => {
            const item = list.createDiv('preview-item');
            item.createDiv({ cls: 'preview-question', text: `Q${q.id}. ${q.text}` });
            item.createDiv({ cls: 'preview-type', text: `Type: ${q.type} | Options: ${q.options.length} | Answer: ${q.correctAnswers.join(', ')}` });
            if (q.imageUrl) {
                item.createDiv({ cls: 'preview-image-info', text: `📷 Image: ${q.imageUrl}` });
            }
        });
        
        modal.open();
    }
}
