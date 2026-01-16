import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

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
    let questionTextLines: string[] = [questionText];
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
    
    constructor(app: App, questions: Question[], settings: ExamCreatorSettings, sourcePath: string) {
        super(app);
        this.settings = settings;
        this.sourcePath = sourcePath;
        
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
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('exam-creator-modal');
        
        // Create header
        const header = contentEl.createDiv('exam-header');
        
        const progressInfo = header.createDiv('exam-progress');
        progressInfo.createSpan({ text: `Question ` });
        progressInfo.createSpan({ cls: 'current-question', text: '1' });
        progressInfo.createSpan({ text: ` of ${this.questions.length}` });
        
        if (this.settings.showTimer) {
            const timerEl = header.createDiv('exam-timer');
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
        
        // Question container
        this.examContainer = contentEl.createDiv('exam-container');
        
        // Navigation
        const nav = contentEl.createDiv('exam-navigation');
        
        const prevBtn = nav.createEl('button', { text: '← Previous', cls: 'exam-btn exam-btn-secondary' });
        prevBtn.onclick = () => this.goToPrevious();
        
        const questionNav = nav.createDiv('question-nav');
        this.questions.forEach((_, idx) => {
            const btn = questionNav.createEl('button', { 
                text: (idx + 1).toString(), 
                cls: 'question-nav-btn' 
            });
            btn.onclick = () => this.goToQuestion(idx);
        });
        
        const nextBtn = nav.createEl('button', { text: 'Next →', cls: 'exam-btn exam-btn-secondary' });
        nextBtn.onclick = () => this.goToNext();
        
        // Submit button
        const submitContainer = contentEl.createDiv('exam-submit-container');
        const submitBtn = submitContainer.createEl('button', { text: 'Submit exam', cls: 'exam-btn exam-btn-primary' });
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
        
        // Update progress bar
        const progressFill = this.contentEl.querySelector('.exam-progress-fill') as HTMLElement;
        if (progressFill) {
            const percentage = ((this.currentIndex + 1) / this.questions.length) * 100;
            progressFill.style.width = `${percentage}%`;
        }
        
        // Update nav buttons
        const navBtns = this.contentEl.querySelectorAll('.question-nav-btn');
        navBtns.forEach((btn, idx) => {
            btn.removeClass('active', 'answered');
            if (idx === this.currentIndex) {
                btn.addClass('active');
            }
            if (this.questions[idx].userAnswer !== undefined) {
                btn.addClass('answered');
            }
        });
        
        // Question card
        const card = this.examContainer.createDiv('question-card');
        
        // Question type badge
        const badge = card.createDiv('question-type-badge');
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
        
        // Question text
        const questionTextEl = card.createDiv('question-text');
        questionTextEl.createEl('strong', { text: `Q${question.id}. ` });
        questionTextEl.createSpan({ text: question.text });
        
        // Image if present
        if (question.imageUrl) {
            const imageContainer = card.createDiv('question-image-container');
            // Try to resolve the image path
            const img = imageContainer.createEl('img', { cls: 'question-image' });
            
            // Handle different image path formats
            const imagePath = question.imageUrl;
            const file = this.app.metadataCache.getFirstLinkpathDest(imagePath, this.sourcePath);
            if (file) {
                img.src = this.app.vault.getResourcePath(file);
            } else {
                // Try as direct URL or relative path
                img.src = imagePath;
            }
            img.alt = 'Question image';
        }
        
        // Answer section
        const answerSection = card.createDiv('answer-section');
        
        if (question.type === 'freetext') {
            // Free text input
            const input = answerSection.createEl('textarea', {
                cls: 'freetext-input',
                attr: { placeholder: 'Type your answer here...' }
            });
            input.value = (question.userAnswer as string) || '';
            input.oninput = () => {
                question.userAnswer = input.value;
                this.updateNavButtons();
            };
        } else {
            // Multiple choice options
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
                
                // Check if this option is selected
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
                label.createSpan({ cls: 'option-letter', text: option.letter });
                label.createSpan({ cls: 'option-text', text: option.text });
                
                input.onchange = () => {
                    if (question.type === 'multiple') {
                        const checked = optionsContainer.querySelectorAll('input:checked');
                        question.userAnswer = Array.from(checked).map(c => (c as HTMLInputElement).value);
                    } else {
                        question.userAnswer = [option.letter];
                    }
                    
                    // Update visual selection
                    optionsContainer.querySelectorAll('.option-item').forEach(item => {
                        item.removeClass('selected');
                    });
                    optionsContainer.querySelectorAll('input:checked').forEach(checked => {
                        checked.closest('.option-item')?.addClass('selected');
                    });
                    
                    this.updateNavButtons();
                };
            });
        }
    }
    
    private updateNavButtons() {
        const navBtns = this.contentEl.querySelectorAll('.question-nav-btn');
        navBtns.forEach((btn, idx) => {
            btn.removeClass('answered');
            const answer = this.questions[idx].userAnswer;
            if (answer !== undefined && 
                (Array.isArray(answer) ? answer.length > 0 : answer !== '')) {
                btn.addClass('answered');
            }
        });
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
        
        // Calculate results
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
                // Case-insensitive comparison for free text
                const userAnswerLower = (q.userAnswer as string).toLowerCase().trim();
                const correctAnswerLower = q.correctAnswers[0].toLowerCase().trim();
                if (userAnswerLower === correctAnswerLower) {
                    correct++;
                } else {
                    wrong++;
                }
            } else {
                // Compare arrays for multiple choice
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
        new ResultsModal(this.app, result, this.sourcePath).open();
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
    
    constructor(app: App, result: ExamResult, sourcePath: string) {
        super(app);
        this.result = result;
        this.sourcePath = sourcePath;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('exam-results-modal');
        
        // Header
        const header = contentEl.createDiv('results-header');
        header.createEl('h2', { text: 'Exam results' });
        
        // Score card
        const scoreCard = contentEl.createDiv('score-card');
        
        const scoreCircle = scoreCard.createDiv('score-circle');
        const percentage = this.result.percentage;
        scoreCircle.addClass(percentage >= 70 ? 'pass' : 'fail');
        scoreCircle.createSpan({ cls: 'score-value', text: `${percentage}%` });
        scoreCircle.createSpan({ cls: 'score-label', text: percentage >= 70 ? 'PASSED' : 'FAILED' });
        
        const stats = scoreCard.createDiv('score-stats');
        
        const statItems = [
            { label: 'Total Questions', value: this.result.totalQuestions.toString(), cls: 'stat-total' },
            { label: 'Correct', value: this.result.correctAnswers.toString(), cls: 'stat-correct' },
            { label: 'Wrong', value: this.result.wrongAnswers.toString(), cls: 'stat-wrong' },
            { label: 'Skipped', value: this.result.skipped.toString(), cls: 'stat-skipped' }
        ];
        
        statItems.forEach(item => {
            const stat = stats.createDiv(`stat-item ${item.cls}`);
            stat.createDiv({ cls: 'stat-value', text: item.value });
            stat.createDiv({ cls: 'stat-label', text: item.label });
        });
        
        // Time taken
        const minutes = Math.floor(this.result.timeTaken / 60);
        const seconds = this.result.timeTaken % 60;
        const timeText = `Time taken: ${minutes}m ${seconds}s`;
        scoreCard.createDiv({ cls: 'time-taken', text: timeText });
        
        // Review section
        const reviewSection = contentEl.createDiv('review-section');
        reviewSection.createEl('h3', { text: 'Review answers' });
        
        this.result.questions.forEach((q, idx) => {
            const isCorrect = this.checkAnswer(q);
            const wasSkipped = !q.userAnswer || 
                (Array.isArray(q.userAnswer) && q.userAnswer.length === 0) ||
                q.userAnswer === '';
            
            const reviewItem = reviewSection.createDiv('review-item');
            reviewItem.addClass(wasSkipped ? 'skipped' : (isCorrect ? 'correct' : 'incorrect'));
            
            // Status icon
            const statusIcon = reviewItem.createDiv('status-icon');
            statusIcon.textContent = wasSkipped ? '○' : (isCorrect ? '✓' : '✗');
            
            // Question content
            const content = reviewItem.createDiv('review-content');
            
            const questionHeader = content.createDiv('review-question-header');
            questionHeader.createSpan({ text: `Q${q.id}. ${q.text}` });
            
            // Image if present
            if (q.imageUrl) {
                const imageContainer = content.createDiv('review-image-container');
                const img = imageContainer.createEl('img', { cls: 'review-image' });
                const file = this.app.metadataCache.getFirstLinkpathDest(q.imageUrl, this.sourcePath);
                if (file) {
                    img.src = this.app.vault.getResourcePath(file);
                } else {
                    img.src = q.imageUrl;
                }
            }
            
            // Show options for multiple choice
            if (q.options.length > 0) {
                const optionsReview = content.createDiv('review-options');
                q.options.forEach(opt => {
                    const optEl = optionsReview.createDiv('review-option');
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
                    
                    optEl.createSpan({ cls: 'option-letter', text: opt.letter });
                    optEl.createSpan({ cls: 'option-text', text: opt.text });
                    
                    if (isCorrectAnswer) {
                        optEl.createSpan({ cls: 'correct-marker', text: ' ✓' });
                    }
                    if (isUserAnswer && !isCorrectAnswer) {
                        optEl.createSpan({ cls: 'wrong-marker', text: ' ✗' });
                    }
                });
            } else {
                // Free text answer review
                const freetextReview = content.createDiv('review-freetext');
                const userAnswerText = typeof q.userAnswer === 'string' ? q.userAnswer : '(not answered)';
                freetextReview.createDiv({ text: `Your answer: ${userAnswerText}` });
                freetextReview.createDiv({ text: `Correct answer: ${q.correctAnswers[0]}`, cls: 'correct-answer-text' });
            }
        });
        
        // Close button
        const btnContainer = contentEl.createDiv('results-buttons');
        const closeBtn = btnContainer.createEl('button', { text: 'Close', cls: 'exam-btn exam-btn-primary' });
        closeBtn.onclick = () => this.close();
    }
    
    private checkAnswer(q: Question): boolean {
        if (!q.userAnswer || 
            (Array.isArray(q.userAnswer) && q.userAnswer.length === 0) ||
            q.userAnswer === '') {
            return false;
        }
        
        if (q.type === 'freetext') {
            const userAnswerLower = (q.userAnswer as string).toLowerCase().trim();
            const correctAnswerLower = q.correctAnswers[0].toLowerCase().trim();
            return userAnswerLower === correctAnswerLower;
        } else {
            const userAnswers = Array.isArray(q.userAnswer) ? q.userAnswer : [q.userAnswer];
            const sortedUser = [...userAnswers].sort().join(',');
            const sortedCorrect = [...q.correctAnswers].sort().join(',');
            return sortedUser === sortedCorrect;
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
        new ExamModal(this.app, questions, this.settings, activeFile.path).open();
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
        modal.contentEl.createEl('h2', { text: `Preview: ${questions.length} Questions Found` });
        
        const list = modal.contentEl.createDiv('preview-list');
        questions.forEach((q, idx) => {
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
