/**
* @file Initialization and main event loop. Include this file after all others.
* @author Michael Pascale
* @modified by ChatGPT (versione semplificata e corretta per esperimento)
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
 ****************************************/
try {
    $.when(
        $.getJSON('options.json').done(function (r) { options = r; }).fail(Fatal),
        $.getJSON('strings.json').done(function (r) { strings = r; }).fail(Fatal)
    ).then(init);
} catch (err) {
    Fatal(err);
}

/****************************************
 * Initialize globals and start game
 ****************************************/
function init() {
    self.recorder = new Recorder(linkid, options['data-server-url'], condition);
    prob = options['probabilities'][condition];

    // 🔹 Nasconde tutte le schermate introduttive
    $('#pre-task-page').hide();
    $('#pre-task2-page').hide();
    $('#pre-task3-page').hide();
    $('#pre-task4-page').hide();
    $('#connecting-page').hide();

    // 🔹 Mostra direttamente il canvas
    start();
}

/****************************************
 * Initialize Cyberball and kick off event loop
 ****************************************/
function start() {
    $('#canvas').show();
    canvas = $('#canvas')[0];
    ctx = canvas.getContext('2d');
    $('#instructions').show();

    /****************************************
     * Initialize Players
     ****************************************/
    self.participant = new Participant();
    self.allPlayers = [participant];

    const maxT = toMilliseconds(options['max-confederate-time']);
    const minT = toMilliseconds(options['min-confederate-time']);
    const timedist = options['confederate-time-dist'];

    // Controlla chi deve ricevere la palla
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
            if (this.sched[this.i] === 'P')
                ret = this.player;
            else
                ret = this.allPlayers.slice(1).reduce((acc, x) => {
                    if (x.id !== from.id) return x;
                    return acc;
                });

            this.i += 1;
            return ret;
        };
    }

    const counter = new Counter(
        140,
        options['p'][condition],
        prob,
        options['sched'][condition],
        self.participant,
        self.allPlayers
    );

    /****************************************
     * Crea i confederati
     ****************************************/
    self.confederates = new Array(options['confederates']);
    for (let i = 0; i < confederates.length; ++i) {
        confederates[i] = new Confederate(`Player ${i == 0 ? 1 : 3}`);

        // Metodo pubblico takeTurn (potrebbe non servire più, ma non fa danni)
        confederates[i].takeTurn = function () {
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
     ****************************************/
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

    // Fine gioco dopo time-limit
    const setend = function () {
        setTimeout(end, toMilliseconds(options['time-limit']));
    };

    // Probe disabilitate
    const setprobe = function () {
        setTimeout(function checkdone() {
            if (self.tosses >= options['tosses']) {
                end();
            } else {
                setTimeout(checkdone, 200);
            }
        }, 200);
    };

    // Click sul canvas (opzionale)
    canvas.addEventListener('mousedown', function (ev) {
        globalBus.emit('click', ev);
    });

    /****************************************
     * Gestione dei lanci
     ****************************************/
    globalBus.register('throwto', function (from, to) {
        console.log('throw from:', from.name || 'participant', '→ to:', to.name || 'participant');

        recorder.record('throw', {
            from: from instanceof Participant ? 'participant' : from.name,
            to: to instanceof Participant ? 'participant' : to.name,
        });

        tosses++;
        globalBus.emit('turn', to);
    });

    /****************************************
     * Gestione dei turni (MODIFICATA)
     ****************************************/
    globalBus.register('turn', (person) => {
        self.currentPlayer = person;

        // 🔹 Partecipante: aspetta input manuale
        if (person instanceof Participant) {
            console.log('È il turno del partecipante — attendendo J/K...');
            return; // il lancio avverrà tramite pressione tasto
        }

        // 🔹 Confederato: lancia automaticamente
        if (person instanceof Confederate) {
            console.log(`È il turno di ${person.name} — lancio automatico...`);
            setTimeout(() => {
                const target = counter.throw(person);
                globalBus.emit('throwto', person, target);
            }, (pickFromDist(range(0, timedist.length), timedist) + noise() + 0.6) * 1000);
        }
    });

    /****************************************
     * Listener per tasti (J, K, ecc.)
     ****************************************/
    function keypress(e) {
        if (self.mode === 'game') {
            switch (e.key) {
                case 'J':
                case 'j':
                    if (self.currentPlayer instanceof Participant) {
                        globalBus.emit('clicked', self.confederates[0]);
                        recorder.record('key', { bt: 'j' });
                    }
                    break;

                case 'K':
                case 'k':
                    if (self.currentPlayer instanceof Participant) {
                        globalBus.emit('clicked', self.confederates[1]);
                        recorder.record('key', { bt: 'k' });
                    }
                    break;

                default:
                    break;
            }
        }

        e.preventDefault();
    }

    document.addEventListener('keydown', keypress);

    /****************************************
     * Listener per "clicked"
     ****************************************/
    globalBus.register('clicked', (target) => {
        if (self.currentPlayer instanceof Participant) {
            console.log('Partecipante lancia verso', target.name);
            globalBus.emit('throwto', self.currentPlayer, target);
        }
    });

    /****************************************
     * Pulsante per ritorno al questionario
     ****************************************/
    $('#return-to-survey')[0].addEventListener('mousedown', function () {
        window.location.href = `${options['survey-url']}?${parameters.toString()}&completed=true`;
    });

    /****************************************
     * Avvio gioco
     ****************************************/
    setprobe();
    setend();
    recorder.begin();
    globalBus.emit('turn', self.participant); // inizia dal partecipante
    tick();
}

/****************************************
 * Main event loop
 ****************************************/
function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = document.documentElement.clientWidth;
    canvas.height = document.documentElement.clientHeight;

    let scale = 0.1666 * Math.min(canvas.height, canvas.width) / participant.sh;
    allPlayers.forEach(c => c.scale(scale));
    ball.scale(0.04 * Math.min(canvas.height, canvas.width) / ball.sh);

    participant.setPosition(pct2px(.5, .6, canvas));
    positionConfederates(
        confederates,
        0.5 * Math.min(canvas.height, canvas.width),
        participant.cx, participant.cy
    );

    confederates.forEach(c => c.hflip = c.dx + c.dw / 2 > canvas.width / 2);
    ball.hflip = currentPlayer.hflip ? true : false;

    ball.setPosition(
        relpx((20 + (ball.hflip ? 150 : 0)) * scale, 48 * scale, currentPlayer)
    );

    globalBus.emit('render', ctx);

    if (!self.halted)
        setTimeout(tick, 1000 / options['framerate']);
}
