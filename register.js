// register.js

const form = document.getElementById('registerForm');
const submitBtn = document.getElementById('submitBtn');
const formError = document.getElementById('formError');
const emailInput = document.getElementById('email');
const emailError = document.getElementById('emailError');
const successMessage = document.getElementById('successMessage');
const clubsContainer = document.getElementById('clubsContainer');
const dynamicQuestionsContainer = document.getElementById('dynamicQuestionsContainer');

function showFormError(message) {
    formError.textContent = message;
    formError.hidden = !message;
}

function setEmailError(message) {
    emailError.textContent = message || '';
    emailError.hidden = !message;
    emailInput.classList.toggle('input--invalid', Boolean(message));
}

function validateEmailField() {
    const value = emailInput.value.trim();

    if (!value) {
        setEmailError('Email is required');
        return false;
    }

    if (!isValidEmail(value)) {
        setEmailError('Please enter a valid email address');
        return false;
    }

    setEmailError('');
    return true;
}

function renderConsumerClubs(clubs) {
    clubsContainer.innerHTML = '';
    const list = Array.isArray(clubs) ? clubs : [];
    if (!list.length) return;

    for (const club of list) {
        const label = document.createElement('label');
        label.className = 'club-toggle';
        const name = club.name || club.label || '';
        label.title = name;

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'consumerClub';
        input.value = name || String(club.id);
        input.className = 'club-toggle__input';

        const logo = document.createElement('span');
        logo.className = 'club-toggle__logo';
        logo.setAttribute('aria-hidden', 'true');
        const logoUrl = club.logoUrl || club.image_url;
        if (logoUrl) {
            const img = document.createElement('img');
            img.src = logoUrl;
            img.alt = '';
            logo.appendChild(img);
        } else {
            logo.textContent = club.initials || name.slice(0, 2).toUpperCase();
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'club-toggle__name';
        nameEl.textContent = name;

        label.appendChild(input);
        label.appendChild(logo);
        label.appendChild(nameEl);
        clubsContainer.appendChild(label);
    }
}

function hideDynamicQuestions() {
    dynamicQuestionsContainer.innerHTML = '';
    dynamicQuestionsContainer.hidden = true;
}

function renderDynamicQuestions(questions) {
    hideDynamicQuestions();
    if (!Array.isArray(questions) || questions.length === 0) return;

    dynamicQuestionsContainer.hidden = false;

    for (const q of questions) {
        const wrap = document.createElement('div');
        wrap.className = 'dynamic-question field';

        const label = document.createElement('label');
        label.htmlFor = `q_${q.id}`;
        label.textContent = q.question_text;
        if (q.is_required) {
            const mark = document.createElement('span');
            mark.className = 'required-mark';
            mark.textContent = ' *';
            label.appendChild(mark);
        }

        wrap.appendChild(label);

        const options = Array.isArray(q.options) ? q.options : [];
        if (q.question_type === 'multiple_choice' && options.length) {
            const select = document.createElement('select');
            select.id = `q_${q.id}`;
            select.name = `question_${q.id}`;
            select.dataset.questionId = String(q.id);
            if (q.is_required) select.required = true;

            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = 'Select an option';
            select.appendChild(blank);

            for (const opt of options) {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                select.appendChild(option);
            }
            wrap.appendChild(select);
        } else {
            const input = document.createElement('input');
            input.id = `q_${q.id}`;
            input.name = `question_${q.id}`;
            input.type = 'text';
            input.dataset.questionId = String(q.id);
            if (q.is_required) input.required = true;
            wrap.appendChild(input);
        }

        dynamicQuestionsContainer.appendChild(wrap);
    }
}

async function loadQuestions() {
    hideDynamicQuestions();

    try {
        const res = await fetch(`${AUTH_API_BASE}/api/questions`);
        if (!res.ok) return;
        const data = await res.json();
        renderDynamicQuestions(data.questions || []);
    } catch (_) {
        hideDynamicQuestions();
    }
}

function collectConsumerClubs() {
    return [...form.querySelectorAll('input[name="consumerClub"]:checked')].map(el => el.value);
}

function collectDynamicAnswers() {
    const answers = {};
    for (const input of form.querySelectorAll('[data-question-id]')) {
        answers[input.dataset.questionId] = input.value.trim();
    }
    return answers;
}

emailInput.addEventListener('input', validateEmailField);
emailInput.addEventListener('blur', validateEmailField);

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError('');

    if (!validateEmailField()) {
        emailInput.focus();
        return;
    }

    if (!form.country.value) {
        showFormError('Please select a country');
        return;
    }

    submitBtn.disabled = true;

    try {
        const installationId = await getOrCreateInstallationId();
        const payload = {
            installationId,
            email: emailInput.value.trim(),
            country: form.country.value,
            consumerClubs: collectConsumerClubs(),
            dynamicAnswers: collectDynamicAnswers(),
            extensionVersion: chrome.runtime.getManifest().version,
            locale: navigator.language,
            platform: navigator.platform
        };

        const res = await fetch(`${AUTH_API_BASE}/api/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || `Registration failed (${res.status})`);
        }

        await saveUserProfile(data.user, installationId);
        location.replace(chrome.runtime.getURL('popup.html'));
        return;
    } catch (err) {
        showFormError(err.message || 'Registration failed');
        submitBtn.disabled = false;
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const profile = await getStoredUserProfile();
    if (profile?.registrationComplete && profile?.userId && profile?.email) {
        form.hidden = true;
        successMessage.textContent = 'You are already registered. Close this tab and use the extension.';
        successMessage.hidden = false;
        return;
    }

    loadQuestions();
    fetch(`${AUTH_API_BASE}/api/clubs`)
        .then((res) => (res.ok ? res.json() : { clubs: [] }))
        .then((data) => renderConsumerClubs(data.clubs || []))
        .catch(() => renderConsumerClubs([]));
});
