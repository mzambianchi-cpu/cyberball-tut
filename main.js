/**
* @file Initialization and main event loop. Include this file after all others.
* @author Michael Pascale (modificato)
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

const parameters = new URLSearchParams(window.location.search);
if (!(['condition', 'linkid'].every(x => parameters.has(x))))
    Fatal('Condition and ID not specified.');

const linkid = parameters.get('linkid');
const condition = parameters.get('condition');


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
 * -> PRE-TASK pages are hidden and the game starts immediately.
 */
function init() {
    self.recorder = new Recorder(linkid, options['data-server-url'], condition);
    prob = options['probabilities'][condition];

    // Hide all pre-task / instruction / connecting pages so participant sees only the game.
    // (IDs follow original markup; hiding extras is safe if they are absent.)
    try { $('#pre-task-page').hide(); } catch (e) {}
    try { $('#pre-task2-page').hide(); } catch (e) {}
    try { $('#pre-task3-page').hide(); } catch (e) {}
    try { $('#pre-task4-page').hide(); } catch (e) {}
    try { $('#loading-page').hide(); } catch (e) {}
    try { $('#connecting-page').hide(); } catch (e) {}
    try { $('#probe-dialogue').hide(); } catch (e) {}

    // Start the game immediately (no pre-task pages, no connecting screen).
    start();
}


/**
 * (Original) Animate the 'connecting' screen. Kept here but not used (we start immediately).
 */
function connecting() {
    $('#loading-page').show();

    const maxT = toMilliseconds(options['max-connecting-time']);
    const minT = toMilliseconds(options['min-connecting-time']);
    const totaltime = DEV_MODE ? 250 : Math.random() * (maxT - minT) + minT;

    setTimeout(() => { $('#connecting-text')[0].innerText = 'Waiting for 2 more participants...'; }, 750);
    setTimeout(() => { $('#connecting-text')[0].innerText = 'Waiting for 1 more participants...'; }, 0.72 * totaltime);
    setTimeout(() => { $('#connecting-text')[0].innerText = 'Starting game.'; }, totaltime - 1000);

    setTimeout(function () {
        $('#loading-page').hide();
        start();
    }, totaltime);
}


/**
* Initialize Cyberball and kick off event loop.
*/
function start() {
    $('#canvas').show();
    canvas = $('#canvas')[0];
    ctx = canvas.getContext('2d');

    // show minimal instructions overlay if present (can be removed)
    // $('#instructions').show();

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


    // Create confederates and attach a public takeTurn method
    self.confederates = new Array(options['confederates']);
    for (let i = 0; i < confederates.length; ++i) {
        // Use Italian labels for on-screen names
        const displayName = `Giocatore ${i === 0 ? 1 : 3}`;

        // Keep the original constructor callback for backward compatibility,
        // but also attach an explicit takeTurn method that the 'turn' listener can call.
        confederates[i] =
            new Confederate(displayName,
                function () {
                    setTimeout(
                        $.proxy(function () {
                            globalBus.emit('throwto', this, counter.throw(this));
                        }, this),
                        (pickFromDist(range(0, timedist.length), timedist)
                            + noise() + 0.6) * 1000
                    );
                });

        // Public method to trigger this confederate's automatic throw (used when turn passes to them)
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

    // Thought probes DISABLED: the game will not pause for probes.
    const setprobe = function () {
        // Just check for completion; do not show probes or halt the game.
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

    // When someone throws to someone else, record it and advance turn.
    globalBus.register('throwto', function (from, to) {
        recorder.record('throw', {
            from: from instanceof Participant ? 'participant' : from.name,
            to: to instanceof Participant ? 'participant' : to.name,
        });

        // increment toss counter
        tosses++;

        // Emit the next turn (this will set currentPlayer and allow next actor to react)
        globalBus.emit('turn', to);
    });

    // When a turn is set, update currentPlayer and if it's a confederate, make them act.
    globalBus.register('turn', (person) => {
        self.currentPlayer = person;

        // If it's a confederate's turn, trigger their automatic throw behavior.
        // We call the public takeTurn method we attached above.
        if (person && person instanceof Confederate && typeof person.takeTurn === 'function') {
            person.takeTurn();
        }
    });

    // Record response to keypresses (player actions and probes)
    function keypress (e) {
        if (self.mode === 'game') {
            switch (e.key) {
            case 'J':
            case 'j':
                // Player chooses left confederate
                // original code emits 'clicked' with the chosen confederate
                globalBus.emit('clicked', self.confederates[0]);
                recorder.record('key', { bt: 'j' });
                break;

            case 'K':
            case 'k':
                // Player chooses right confederate
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
            // Probe handling kept for compatibility but probes are never shown under current setprobe()
            switch (e.key) {
            case '1':
            case '2':
                recorder.record('key', { bt: e.key });
                recorder.record('probe', { q1: e.key });
                recorder.record('closeprobe', { });
                try { $('#probe-dialogue').hide(); } catch (ex) {}
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

    // Start turn with participant so player can act immediately.
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

    if (currentPlayer && currentPlayer.hflip)
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
