document.addEventListener('DOMContentLoaded', function() {
    const fileList = document.getElementById('fileList');
    const codeEditor = document.getElementById('codeEditor');
    const currentFileSpan = document.getElementById('currentFile');
    const outputContent = document.getElementById('outputContent');
    
    const regenerateBtn = document.querySelector('.regenerate-btn');
    const compileBtn = document.querySelector('.compile-btn');
    const saveBtn = document.querySelector('.save-btn');
    const undoBtn = document.querySelector('.undo-btn');
    const redoBtn = document.querySelector('.redo-btn');
    const zoomInBtn = document.querySelector('.zoom-in');
    const zoomOutBtn = document.querySelector('.zoom-out');

    // AI Autocomplete and Chat variables
    let autocompleteTimeout;
    let selectedText = '';
    let chatHistory = [];

    let currentFile = 'generated_document.tex';
    let fileContents = {
        'generated_document.tex': `% AI-generated LaTeX Document
\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{geometry}
\\usepackage{lipsum} % For dummy text

\\geometry{a4paper, margin=1in}

\\title{Analysis of AI Impact on Modern Workflows}
\\author{uea AI}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Artificial Intelligence (AI) is transforming industries by automating tasks, enabling data-driven decisions, and creating new opportunities for innovation. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

\\subsection{Problem Statement}
The primary challenge is to integrate AI models seamlessly into existing enterprise workflows without causing significant disruption. This requires careful planning and execution.

\\section{Methodology}
We analyze the effectiveness of AI using the following approach:

\\begin{equation}
E = mc^2 \\label{eq:emc2}
\\end{equation}

As shown in Equation \\ref{eq:emc2}, the potential impact is significant.

\\section{Results}
Our analysis shows that AI integration can improve efficiency by up to 40\\%.

\\section{Conclusion}
AI represents a paradigm shift in how we approach complex problems.

\\end{document}`,
        'references.bib': `@article{ai2023,
  title={Artificial Intelligence in Modern Workflows},
  author={uea AI},
  journal={Journal of AI Applications},
  year={2023},
  volume={1},
  number={1},
  pages={1--15}
}`,
        'style.cls': `\\NeedsTeXFormat{LaTeX2e}
\\ProvidesClass{article}[2023/11/26 Custom Article Class]

\\LoadClass[12pt,a4paper]{article}

\\usepackage{geometry}
\\geometry{margin=1in}

\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}

\\usepackage{graphicx}
\\usepackage{color}
\\usepackage{hyperref}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=cyan
}`
    };

    // Initialize editor with default content
    codeEditor.value = fileContents[currentFile];

    // File switching functionality
    fileList.addEventListener('click', function(e) {
        if (e.target.classList.contains('file-item')) {
            // Update active file
            document.querySelectorAll('.file-item').forEach(item => {
                item.classList.remove('active');
            });
            e.target.classList.add('active');
            
            // Switch file content
            const fileName = e.target.dataset.file;
            currentFile = fileName;
            currentFileSpan.textContent = fileName;
            codeEditor.value = fileContents[fileName] || '';
        }
    });

    // Save content when editor changes
    codeEditor.addEventListener('input', function() {
        fileContents[currentFile] = codeEditor.value;
    });

    // AI Autocomplete functionality
    codeEditor.addEventListener('input', function() {
        clearTimeout(autocompleteTimeout);
        autocompleteTimeout = setTimeout(() => {
            const cursorPos = codeEditor.selectionStart;
            const currentText = codeEditor.value;
            
            if (currentText.length > 0 && cursorPos > 0) {
                requestAutocomplete(currentText, cursorPos);
            }
        }, 500);
    });

    // Handle text selection for AI chat
    codeEditor.addEventListener('mouseup', function() {
        const selection = codeEditor.value.substring(codeEditor.selectionStart, codeEditor.selectionEnd);
        if (selection.length > 0) {
            selectedText = selection;
            updateSelectedTextDisplay();
        }
    });

    codeEditor.addEventListener('keyup', function() {
        const selection = codeEditor.value.substring(codeEditor.selectionStart, codeEditor.selectionEnd);
        if (selection.length > 0) {
            selectedText = selection;
            updateSelectedTextDisplay();
        }
    });

    // Regenerate AI content
    regenerateBtn.addEventListener('click', async function() {
        try {
            const response = await fetch('/regenerate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({
                    current_content: codeEditor.value,
                    file: currentFile
                })
            });

            if (response.ok) {
                const result = await response.json();
                codeEditor.value = result.latex_content;
                fileContents[currentFile] = result.latex_content;
            } else {
                alert('Failed to regenerate content');
            }
        } catch (error) {
            console.error('Regenerate error:', error);
            alert('Failed to regenerate content');
        }
    });

    // Compile and render
    compileBtn.addEventListener('click', async function() {
        try {
            const response = await fetch('/compile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({
                    latex_content: codeEditor.value
                })
            });

            if (response.ok) {
                const result = await response.json();
                
                // Update rendered output
                updateRenderedOutput(result.pdf_url);
            } else {
                alert('Compilation failed');
            }
        } catch (error) {
            console.error('Compile error:', error);
            alert('Compilation failed');
        }
    });

    // Save project
    saveBtn.addEventListener('click', async function() {
        try {
            const response = await fetch('/save-project', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({
                    files: fileContents,
                    current_file: currentFile
                })
            });

            if (response.ok) {
                alert('Project saved successfully');
            } else {
                alert('Failed to save project');
            }
        } catch (error) {
            console.error('Save error:', error);
            alert('Failed to save project');
        }
    });

    // Undo/Redo functionality (simplified)
    let undoStack = [];
    let redoStack = [];

    codeEditor.addEventListener('input', function() {
        undoStack.push(codeEditor.value);
        redoStack = [];
    });

    undoBtn.addEventListener('click', function() {
        if (undoStack.length > 1) {
            redoStack.push(undoStack.pop());
            codeEditor.value = undoStack[undoStack.length - 1];
            fileContents[currentFile] = codeEditor.value;
        }
    });

    redoBtn.addEventListener('click', function() {
        if (redoStack.length > 0) {
            const content = redoStack.pop();
            undoStack.push(content);
            codeEditor.value = content;
            fileContents[currentFile] = content;
        }
    });

    // Zoom functionality
    let currentZoom = 100;
    
    zoomInBtn.addEventListener('click', function() {
        currentZoom = Math.min(currentZoom + 10, 200);
        updateZoom();
    });

    zoomOutBtn.addEventListener('click', function() {
        currentZoom = Math.max(currentZoom - 10, 50);
        updateZoom();
    });

    function updateZoom() {
        outputContent.style.transform = `scale(${currentZoom / 100})`;
        outputContent.style.transformOrigin = 'top left';
    }

    function updateRenderedOutput(pdfUrl) {
        // For demo purposes, show a preview
        // In production, this would embed the PDF or show a rendered preview
        outputContent.innerHTML = `
            <div class="rendered-document">
                <h1>Analysis of AI Impact on Modern Workflows</h1>
                <p><strong>uea AI</strong></p>
                <p>November 26, 2023</p>
                <h2>1 Introduction</h2>
                <p>Artificial Intelligence (AI) is transforming industries by automating tasks, enabling data-driven decisions, and creating new opportunities for innovation. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
                <h3>1.1 Problem Statement</h3>
                <p>The primary challenge is to integrate AI models seamlessly into existing enterprise workflows without causing significant disruption.</p>
                <h2>2 Methodology</h2>
                <p>We analyze the effectiveness of AI using the following approach:</p>
                <p><em>E = mc²</em></p>
                <p>As shown in the equation above, the potential impact is significant.</p>
                <h2>3 Results</h2>
                <p>Our analysis shows that AI integration can improve efficiency by up to 40%.</p>
                <h2>4 Conclusion</h2>
                <p>AI represents a paradigm shift in how we approach complex problems.</p>
            </div>
        `;
    }

    // Load project from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');
    
    if (projectId) {
        loadProject(projectId);
    }

    async function loadProject(projectId) {
        try {
            const response = await fetch(`/projects/${projectId}`, {
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });

            if (response.ok) {
                const project = await response.json();
                codeEditor.value = project.latex_content;
                fileContents['generated_document.tex'] = project.latex_content;
                currentFile = 'generated_document.tex';
                currentFileSpan.textContent = currentFile;
            }
        } catch (error) {
            console.error('Load project error:', error);
        }
    }

    function getAuthToken() {
        return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
    }

    // AI Autocomplete Functions
    async function requestAutocomplete(currentText, cursorPosition) {
        try {
            const response = await fetch('/ai/autocomplete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({
                    current_text: currentText,
                    cursor_position: cursorPosition,
                    context: currentFile
                })
            });

            if (response.ok) {
                const result = await response.json();
                showAutocompleteSuggestions(result.suggestions);
            }
        } catch (error) {
            console.error('Autocomplete error:', error);
        }
    }

    function showAutocompleteSuggestions(suggestions) {
        const autocompleteBox = document.getElementById('autocompleteBox');
        const autocompleteList = document.getElementById('autocompleteList');
        
        if (suggestions.length === 0) {
            autocompleteBox.style.display = 'none';
            return;
        }

        autocompleteList.innerHTML = '';
        
        suggestions.forEach((suggestion, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerHTML = `
                <div class="autocomplete-text">${suggestion.text}</div>
                <div class="autocomplete-description">${suggestion.description}</div>
            `;
            
            item.addEventListener('click', () => {
                insertAutocompleteSuggestion(suggestion.text);
            });
            
            item.addEventListener('mouseenter', () => {
                document.querySelectorAll('.autocomplete-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
            });
            
            autocompleteList.appendChild(item);
        });
        
        autocompleteBox.style.display = 'block';
    }

    function insertAutocompleteSuggestion(text) {
        const cursorPos = codeEditor.selectionStart;
        const currentText = codeEditor.value;
        
        const beforeCursor = currentText.substring(0, cursorPos);
        const afterCursor = currentText.substring(cursorPos);
        
        codeEditor.value = beforeCursor + text + afterCursor;
        codeEditor.selectionStart = cursorPos + text.length;
        codeEditor.selectionEnd = cursorPos + text.length;
        codeEditor.focus();
        
        closeAutocomplete();
    }

    function closeAutocomplete() {
        document.getElementById('autocompleteBox').style.display = 'none';
    }

    // AI Chat Functions
    function openAIChat() {
        const modal = document.getElementById('aiChatModal');
        modal.style.display = 'flex';
        loadChatHistory();
    }

    function closeAIChat() {
        const modal = document.getElementById('aiChatModal');
        modal.style.display = 'none';
    }

    function updateSelectedTextDisplay() {
        const display = document.getElementById('selectedTextDisplay');
        if (selectedText.length > 0) {
            display.textContent = selectedText;
            display.style.color = '#4caf50';
        } else {
            display.textContent = 'No text selected';
            display.style.color = '#999999';
        }
    }

    async function sendChatMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        
        if (!message || !selectedText) {
            alert('Please select some text and enter a message');
            return;
        }

        // Add user message to chat
        addChatMessage('user', message, new Date());

        try {
            const response = await fetch('/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({
                    selected_text: selectedText,
                    user_message: message,
                    full_document: codeEditor.value
                })
            });

            if (response.ok) {
                const result = await response.json();
                addChatMessage('ai', result.response, new Date());
                
                // Offer to apply the improved text
                if (result.improved_text && result.improved_text !== selectedText) {
                    offerToApplyImprovement(result.improved_text);
                }
            } else {
                throw new Error('Chat request failed');
            }
        } catch (error) {
            console.error('Chat error:', error);
            addChatMessage('ai', 'Sorry, I encountered an error. Please try again.', new Date());
        }

        chatInput.value = '';
    }

    function addChatMessage(sender, content, timestamp) {
        const chatHistory = document.getElementById('chatHistory');
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}`;
        
        const timeString = timestamp.toLocaleTimeString();
        messageDiv.innerHTML = `
            <div class="chat-message-header">
                <span>${sender === 'user' ? 'You' : 'AI Assistant'}</span>
                <span>${timeString}</span>
            </div>
            <div class="chat-message-content">${formatChatContent(content)}</div>
        `;
        
        chatHistory.appendChild(messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function formatChatContent(content) {
        // Convert LaTeX code blocks to formatted HTML
        return content
            .replace(/```latex\n([\s\S]*?)\n```/g, '<pre>$1</pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    function offerToApplyImprovement(improvedText) {
        const applyButton = document.createElement('button');
        applyButton.textContent = 'Apply This Improvement';
        applyButton.className = 'apply-improvement-btn';
        applyButton.style.cssText = `
            background: #4caf50;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
            font-size: 12px;
        `;
        
        applyButton.addEventListener('click', () => {
            applyTextImprovement(improvedText);
            applyButton.remove();
        });
        
        const lastMessage = document.querySelector('.chat-message.ai:last-child .chat-message-content');
        lastMessage.appendChild(applyButton);
    }

    function applyTextImprovement(improvedText) {
        const currentText = codeEditor.value;
        const startPos = codeEditor.selectionStart;
        const endPos = codeEditor.selectionEnd;
        
        const beforeSelection = currentText.substring(0, startPos);
        const afterSelection = currentText.substring(endPos);
        
        codeEditor.value = beforeSelection + improvedText + afterSelection;
        codeEditor.selectionStart = startPos;
        codeEditor.selectionEnd = startPos + improvedText.length;
        codeEditor.focus();
        
        // Update file contents
        fileContents[currentFile] = codeEditor.value;
        
        alert('Improvement applied successfully!');
    }

    async function loadChatHistory() {
        try {
            const response = await fetch('/ai/chat-history', {
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                chatHistory = result.chat_history;
                
                // Display recent chat history
                const chatHistoryDiv = document.getElementById('chatHistory');
                chatHistoryDiv.innerHTML = '';
                
                chatHistory.slice(0, 5).forEach(chat => {
                    addChatMessage('user', chat.user_message, new Date(chat.timestamp?.toDate?.() || chat.timestamp));
                    addChatMessage('ai', chat.ai_response, new Date(chat.timestamp?.toDate?.() || chat.timestamp));
                });
            }
        } catch (error) {
            console.error('Error loading chat history:', error);
        }
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Ctrl+Space for autocomplete
        if (e.ctrlKey && e.code === 'Space') {
            e.preventDefault();
            const cursorPos = codeEditor.selectionStart;
            const currentText = codeEditor.value;
            requestAutocomplete(currentText, cursorPos);
        }
        
        // Escape to close autocomplete
        if (e.code === 'Escape') {
            closeAutocomplete();
        }
    });
});
