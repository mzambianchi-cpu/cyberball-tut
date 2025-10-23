/**
* @file Initialization and main event loop. Include this file after all others.
* @author Michael Pascale
* @copyright Michael Pascale 2020
* @license MIT
*/

/*global DEV_MODE, globalBus, Fatal, Recorder, recorder, range, noise */
/*global toMilliseconds, pct2px, pickFromDist, relpx, positionConfederates */
/*global pickAnother, Participant, Confederate, Ball */
/*global participant, confederates, ball, allPlayers, currentPlayer */


var options;
var strings;
var canvas;
var ctx;
var tosses;
var prob;

const urlParams = new URLSearchParams(window.location.search);
const condition = urlParams.get('condition') || 'neutra';

const linkid = urlParams.get('linkid') || Math.floor(Math.random() * 10000000);

console.log("Condizione:", condition);
console.log("LinkID:", linkid);

/****************************************
 * Fetch configuration JSON, then call init().
 * */
try {
    $.when(
        $.getJSON('options.json').done(function (r) {
            options = r;
        }).fail(Fatal),
        $.getJSON('strings.json').done(function (r) {
            strings = r;
        }).fail(Fatal)
    ).then(init);

} catch (err) {
    Fatal(err);
}


/**
 * Initialize globals and set HTML text.
 */
function init() {
    self.recorder = new Recorder(linkid, options['data-server-url'], condition);
    prob = options['probabilities'][condition];

    // 🔹 Salta tutte le pagine iniziali e parte subito il gioco
    $('#pre-task-page').hide();
    $('#pre-task2-page').hide();
    $('#pre-task3-page').hide();
    $('#pre-task4-page').hide();
    $('#connecting-page').hide();

    // 🔹 Avvia direttamente il gioco
    start();
}

/**
* Initialize Cyberball and kick off event loop.
*/
function start() {
    $('#canvas').show();
    canvas = $('#canvas')[0];
    ctx = canvas.getContext('2d');

    $('#instructions').show();

    // $('#p1bt')[0].addEventListener('mousedown', function () {
    //     recorder.record('playerbt', { bt: 'p1' });
    // });

    // $('#p3bt')[0].addEventListener('mousedown', function () {
    //     recorder.record('playerbt', { bt: 'p3' });
    // });


    /****************************************
     * Initialize Players
     * */
    self.participant = new Participant();
    self.allPlayers = [participant];

    const maxT = toMilliseconds(options['max-confederate-time']);
    const minT = toMilliseconds(options['min-confederate-time']);
    const timedist = options['confederate-time-dist'];

    function Counter(n, p, prob, sched, player, allPlayers) {
        this.n = n;
        this.p = p;
        this.np = n * p;
        this.nc = n - this.np;

        this.i = 0;

        this.prob = prob;
        this.sched = sched;
        this.player = player;
        this.allPlayers = allPlayers;

        this.throw = function (from) {
            if (this.i > this.sched.length)
                return pickAnother(from, this.allPlayers, this.prob);

            let ret;
            // Player
            if (this.sched[this.i] === 'P')
                ret = this.player;

            // Confederate
            else
                ret = this.allPlayers.slice(1).reduce((acc, x) => {
                    if (x.id !== from.id)
                        return x;
                    return acc;
                });

            this.i += 1;
            return ret;
        };
    }

    const counter = new Counter(140, options['p'][condition], prob, options['sched'][condition], self.participant, self.allPlayers);


    // TODO Name confederates randomly or by i +1
self.confederates = new Array(options['confederates']);
for (let i = 0; i < confederates.length; ++i) {
    confederates[i] = new Confederate(`Player ${i == 0 ? 1 : 3}`);

    // qui aggiungi il metodo takeTurn
    confederates[i].takeTurn = function() {
        setTimeout(() => {
            const target = counter.throw(this);
            globalBus.emit('throwto', this, target);
        }, (pickFromDist(range(0, timedist.length), timedist) + noise() + 0.6) * 1000);
    };
}

    allPlayers.push(...confederates);

    self.ball = new Ball();


    /****************************************
     * Setup UI Handlers
     * */
    self.halted = false;
    self.mode = 'game';
    self.probe = 0;
    self.tosses = 0;

    const end = function () {
        $('#end-dialogue').show();
        self.halted = true;
        self.mode = false;
        recorder.send(() => $('#return-to-survey').prop('disabled', false));
    };

    // Set end time.
    const setend = function () {
        setTimeout(end, toMilliseconds(options['time-limit']));
    };

    // Thought probes disabilitate
const setprobe = function () {
    // Controlla solo quando il gioco è finito
    setTimeout(function checkdone() {
        if (self.tosses >= options['tosses']) {
            end();
        } else {
            setTimeout(checkdone, 200);
        }
    }, 200);
};
    // Register event listeners.
    canvas.addEventListener('mousedown', function (ev) {
        globalBus.emit('click', ev);
    });

    globalBus.register('throwto', function (from, to) {
    recorder.record('throw', {
        from: from instanceof Participant ? 'participant' : from.name,
        to: to instanceof Participant ? 'participant' : to.name,
    });

    // 🔹 Aggancia la palla al destinatario
    self.ball.setCurrentPlayer(to);

    tosses++;
    globalBus.emit('turn', to);

    // 🔹 Se il destinatario è un confederato, fallo lanciare dopo un breve ritardo
    if (to instanceof Confederate) {
        to.takeTurn();
    }
});

    globalBus.register('turn', (person) => {
    self.currentPlayer = person;
    if (person instanceof Confederate) {
        person.takeTurn();
    }
});

    // Record response to MW probe.
    function keypress (e) {
        if (self.mode === 'game') {
            switch (e.key) {
            case 'J':
            case 'j':
                globalBus.emit('clicked', self.confederates[0]);
                recorder.record('key', { bt: 'j' });
                break;

            case 'K':
            case 'k':
                globalBus.emit('clicked', self.confederates[1]);
                recorder.record('key', { bt: 'k' });
                break;

            case ' ':
            case 'Spacebar':
                recorder.record('key', { bt: 'space' });
                break;

            default:
            }

        } else if (self.mode === 'probe') {
            switch (e.key) {
            case '1':
            case '2':
            //case '3':
                recorder.record('key', { bt: e.key });
                recorder.record('probe', { q1: e.key });
                recorder.record('closeprobe', { });
                $('#probe-dialogue').hide();
                self.mode = 'game';
                self.halted = false;
                setprobe();

                setTimeout(tick, 16);
                break;

            default:
            }
        }

        e.preventDefault();
    }

    document.addEventListener('keydown', keypress);



    $('#return-to-survey')[0].addEventListener('mousedown', function () {
        window.location.href = `${options['survey-url']}?${parameters.toString()}&completed=true`;
    });


    /****************************************
     * Set events and begin the task.
     * */
    setprobe();
    setend();

    recorder.begin();

    globalBus.emit('turn', self.participant);
    tick();
}


/**
* Main event loop. Redraw the canvas at a specified rate.
*/
function tick() {


    /****************************************
     * Clear and rescale the canvas to the current window dimensions.
     * */
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = document.documentElement.clientWidth;
    canvas.height = document.documentElement.clientHeight;

    let scale = 0.1666 * Math.min(canvas.height, canvas.width) / participant.sh;
    allPlayers.forEach(c => c.scale(scale));
    ball.scale(0.04 * Math.min(canvas.height, canvas.width) / ball.sh);

    participant.setPosition(pct2px(.5, .6, canvas));
    positionConfederates(
        confederates, 0.5 * Math.min(canvas.height, canvas.width),
        participant.cx, participant.cy
    );
    confederates.forEach(c => c.hflip = c.dx + c.dw / 2 > canvas.width / 2);

    if (currentPlayer.hflip)
        ball.hflip = true;
    else ball.hflip = false;

    ball.setPosition(
        relpx((20 + (ball.hflip ? 150 : 0)) * scale, 48 * scale, currentPlayer)
    );


    /****************************************
     * Emit the render event to redraw the canvas.
     * */
    globalBus.emit('render', ctx);


    /****************************************
     * Prepare next tick. Stop if halted.
     * */
    if (!self.halted)
        setTimeout(tick, 1000 / options['framerate']);
}
