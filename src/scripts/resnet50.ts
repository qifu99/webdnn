/// <reference path="../libs/webdnn.d.ts" />
import "../style/resnet50.scss";
import "./modules/analytics.js";
import ImagePicker from "./modules/image_picker";
import Labels from "./modules/imagenet_labels";
import InitializingView from "./modules/initializing_view";
import GraphDescriptor = WebDNN.GraphDescriptor;

declare function ga(...args: any[]): void

const KEY_WEBGPU_LAST_STATUS = 'webgpu_last_status';
const KEY_FLAG_WEBGPU_DISABLED_ALERT = 'flag_webgpu_disabled_alert';

const NUM_RANDOM_IMAGE = 6;

let FLAG_CHROME_ANDROID: boolean = false;

enum State {
    INITIALIZING,
    NO_IMAGE,
    STAND_BY,
    RUNNING,
    ERROR
}

function softMax(arr: number[]) {
    let exps: number[] = [];
    let sum = 0;

    for (let i = 0; i < arr.length; i++) {
        let e = Math.exp(arr[i]);
        sum += e;
        exps[i] = e;
    }
    for (let i = 0; i < arr.length; i++) {
        exps[i] /= sum;
    }

    return exps;
}

const App = new class {
    picker: ImagePicker;
    context: CanvasRenderingContext2D;
    runner: WebDNN.DescriptorRunner<GraphDescriptor>;
    inputView: Float32Array;
    outputView: Float32Array;
    runButton: HTMLButtonElement;
    resultLabels: HTMLElement[];
    resultBars: HTMLElement[];
    resultProbabilities: HTMLElement[];
    labels: string[];
    randomImageIndex: number;
    state: State;
    messageView: HTMLElement;
    lastStatus: string = '';

    async initialize() {
        ga('send', 'event', 'ResNet50', 'launch');

        this.setState(State.INITIALIZING);
        this.randomImageIndex = Math.floor(Math.random() * NUM_RANDOM_IMAGE);

        let canvas = document.getElementById('canvas') as HTMLCanvasElement;
        let context = canvas.getContext('2d');
        if (!context) throw new Error('Context is null');

        this.context = context;
        this.picker = new ImagePicker(
            document.getElementById('imageInput') as HTMLInputElement, context
        );
        this.picker.onload = () => {
            this.setState(State.STAND_BY);
        };

        let runButton = document.getElementById('runButton') as HTMLButtonElement;
        if (!runButton) throw Error('#runButton is not found.');
        this.runButton = runButton;
        this.runButton.addEventListener('click', () => App.predict());

        let loadRandomButton = document.getElementById('loadRandomButton');
        if (!loadRandomButton) throw Error('#loadRandomButton is not found.');
        loadRandomButton.addEventListener('click', () => App.loadRandomImage());

        let messageView = document.getElementById('message');
        if (!messageView) throw Error('#message is not found.');
        this.messageView = messageView;

        this.resultLabels = [];
        this.resultBars = [];
        this.resultProbabilities = [];
        let predictedItems = document.querySelectorAll('.ResultItem');
        if (predictedItems.length != 10) throw Error('# of .ResultItem must be 10.');
        for (let i = 0; i < 10; i++) {
            let item = predictedItems[i];

            let resultLabel = item.querySelector('.ResultItem-Label') as HTMLElement;
            if (!resultLabel) throw Error('.ResultItem-Label is not found.');
            this.resultLabels.push(resultLabel);

            let resultBar = item.querySelector('.ResultItem-Bar') as HTMLElement;
            if (!resultBar) throw Error('.ResultItem-Bar is not found.');
            this.resultBars.push(resultBar);

            let resultProbability = item.querySelector('.ResultItem-Probability') as HTMLElement;
            if (!resultProbability) throw Error('.ResultItem-Probability is not found.');
            this.resultProbabilities.push(resultProbability);
        }

        let launchView = document.getElementById('launchView');
        if (launchView && launchView.parentNode) {
            launchView.parentNode.removeChild(launchView);
            launchView = null;
        }

        let initializingViewBase = document.getElementById('initializingView');
        if (!initializingViewBase) throw Error('#initializingView is not found');
        let initializingView = new InitializingView(initializingViewBase);

        if (FLAG_CHROME_ANDROID) {
            initializingView.updateMessage('Sorry, but this application can\'t work on Chrome for Android.');
            return;
        } else {
            console.log(navigator.userAgent);
        }

        let availability = WebDNN.getBackendAvailability();
        if (availability.status['webgpu']) {
            this.lastStatus = localStorage.getItem(KEY_WEBGPU_LAST_STATUS) || 'none';
            switch (this.lastStatus) {
                case 'none':
                    break;

                case 'running':
                case 'crashed':
                    availability.status['webgpu'] = false;
                    availability.defaultOrder.splice(availability.defaultOrder.indexOf('webgpu'), 1);

                    localStorage.setItem(KEY_WEBGPU_LAST_STATUS, 'crashed');

                    console.warn('This browser supports WebGPU. However, it was crashed at last execution with WebGPU. Therefore, WebDNN disabled WebGPU backend temporally.');

                    if (!localStorage.getItem(KEY_FLAG_WEBGPU_DISABLED_ALERT)) {
                        alert('This browser supports WebGPU. However, it was crashed at last execution with WebGPU. \n\nTherefore, WebDNN disabled WebGPU backend temporally.');
                        localStorage.setItem(KEY_FLAG_WEBGPU_DISABLED_ALERT, '1');
                    }
                    break;

                case 'completed':
                    break;
            }
        }

        initializingView.updateMessage('Load label data');

        this.labels = Labels;

        initializingView.updateMessage('Load model data');
        await WebDNN.init(availability.defaultOrder);
        this.runner = WebDNN.runner!;
        let start = performance.now();
        await this.runner.load('./models/resnet50', (loaded, total) => initializingView.updateProgress(loaded / total));
        let loadingTime = performance.now() - start;
        ga('send', 'event', 'ResNet50', 'play', `loading_time-${WebDNN.backendName}`, Math.round(loadingTime));
        this.inputView = (await this.runner.getInputViews())[0];
        this.outputView = (await this.runner.getOutputViews())[0];

        initializingView.remove();
        this.setState(State.NO_IMAGE);
        this.loadRandomImage();
    }

    setMessage(message: string) {
        if (this.messageView) {
            this.messageView.textContent = message;
        }
    }

    setState(state: State) {
        this.state = state;
        switch (state) {
            case State.INITIALIZING:
                this.setMessage('Initializing...');
                if (this.runButton) {
                    this.runButton.textContent = 'Initializing...';
                    this.runButton.disabled = true;
                }
                break;

            case State.NO_IMAGE:
                this.setMessage('Select an image, and click "Run" button.');
                if (this.runButton) {
                    this.runButton.textContent = 'Run';
                    this.runButton.disabled = true;
                }
                break;

            case State.STAND_BY:
                this.setMessage(`Ready(backend: ${this.runner.backendName})`);
                if (this.runButton) {
                    this.runButton.textContent = 'Run';
                    this.runButton.disabled = false;
                }
                break;

            case State.RUNNING:
                this.setMessage('Running...');
                if (this.runButton) {
                    this.runButton.textContent = 'Running...';
                    this.runButton.disabled = true;
                }
                break;

            case State.ERROR:
                this.setMessage('Error');
                if (this.runButton) {
                    this.runButton.textContent = 'Error';
                    this.runButton.disabled = true;
                }
                break;
        }
    }

    setInputImageData() {
        let w = this.context.canvas.width;
        let h = this.context.canvas.height;
        let imageData = this.context.getImageData(0, 0, w, h);
        let pixelData = imageData.data;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                this.inputView[(y * w + x) * 3] = pixelData[(y * w + x) * 4 + 2] - 103.939;
                this.inputView[(y * w + x) * 3 + 1] = pixelData[(y * w + x) * 4 + 1] - 116.779;
                this.inputView[(y * w + x) * 3 + 2] = pixelData[(y * w + x) * 4] - 123.68;
            }
        }
    }

    loadRandomImage() {
        this.randomImageIndex = (this.randomImageIndex + 1) % NUM_RANDOM_IMAGE;
        this.picker.loadByUrl(`./assets/images/${this.randomImageIndex}.png`);
    }

    async predict() {
        this.setState(State.RUNNING);
        this.setInputImageData();

        if (this.runner.backendName === 'webgpu' && this.lastStatus === 'none') {
            localStorage.setItem(KEY_WEBGPU_LAST_STATUS, 'running');
            this.lastStatus = 'running';
        }
        let start = performance.now();
        await this.runner.run();
        let computationTime = performance.now() - start;
        if (this.runner.backendName === 'webgpu' && this.lastStatus === 'running') {
            localStorage.setItem(KEY_WEBGPU_LAST_STATUS, 'completed');
            this.lastStatus = 'completed';
        }

        let output: number[] = [];
        for (let i = 0; i < this.outputView.length; i++) {
            output.push(this.outputView[i]);
        }

        let probability = softMax(output);
        let top5 = WebDNN.Math.argmax(probability.slice(0), 10);

        top5.forEach((labelId, i) => {
            this.resultProbabilities[i].textContent = `${(probability[labelId] * 100).toFixed(1)}%`;
            this.resultProbabilities[i].style.opacity = '1';
            this.resultBars[i].style.width = `${(probability[labelId] * 100)}%`;
            this.resultBars[i].style.opacity = '' + (0.3 + probability[labelId] * 0.7);
            this.resultLabels[i].textContent = this.labels[labelId];
            this.resultLabels[i].style.opacity = '1';
        });

        this.setState(State.STAND_BY);
        this.setMessage(`Computation Time: ${computationTime.toFixed(2)} [ms]`);

        try {
            ga('send', 'event', 'ResNet50', 'play', 'computation_time', Math.round(computationTime));
        } catch (e) {}
    }
};

window.onload = () => {
    FLAG_CHROME_ANDROID = ((/Android(.*)Chrome/).test(navigator.userAgent));

    WebDNN.registerTransformDelegate((url: string) => {
        let ma = url.match(/([^/]+)(?:\?.*)?$/);

        if (ma) {
            return `https://mil-tokyo.github.io/webdnn-data/models/resnet50/${ma[1]}?raw=true&v=2`;
        } else {
            return url;
        }
    });

    let runAppButton = document.getElementById('runAppButton');
    if (!runAppButton) throw Error('#runAppButton is not found');
    runAppButton.addEventListener('click', () => App.initialize());

    if (location.search == '?run=1') {
        App.initialize();
    }
};

window.onerror = (message: string, filename?: string, lineno?: number, colno?: number, error?:Error) => {
    ga('send', 'exception', { 'exDescription': message, 'exFatal': false });
};