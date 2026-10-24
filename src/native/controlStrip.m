// downstream's player controls in the macos control strip, for while another app is in front.
// downstream starts this helper and talks to it over stdin and stdout, one json message per line.
// the control strip and system bars are private macos api, so they are looked up at runtime and the helper quits quietly without them.

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <dlfcn.h>
#include <signal.h>

@interface NSTouchBarItem (DownstreamPrivate)
+ (void)addSystemTrayItem:(NSTouchBarItem *)item;
+ (void)removeSystemTrayItem:(NSTouchBarItem *)item;
@end

@interface NSTouchBar (DownstreamPrivate)
+ (void)presentSystemModalTouchBar:(NSTouchBar *)touchBar systemTrayItemIdentifier:(NSTouchBarItemIdentifier)identifier;
+ (void)dismissSystemModalTouchBar:(NSTouchBar *)touchBar;
@end

static void (*setStripPresence)(NSTouchBarItemIdentifier, BOOL);
static void (*showCloseBox)(BOOL);

static NSTouchBarItemIdentifier const STRIP = @"com.stratabytes.downstream.strip";
static NSTouchBarItemIdentifier const TRANSPORT = @"com.stratabytes.downstream.transport";
static NSTouchBarItemIdentifier const TITLE = @"com.stratabytes.downstream.title";
static NSTouchBarItemIdentifier const VOLUME = @"com.stratabytes.downstream.volume";
static NSTouchBarItemIdentifier const SHUFFLE = @"com.stratabytes.downstream.shuffle";
static NSTouchBarItemIdentifier const REPEAT = @"com.stratabytes.downstream.repeat";

// the bar gets about 620pt beside the control strip, so the controls are slimmer than usual to leave the title room.
static const CGFloat TITLE_WIDTH = 170;
static const CGFloat TITLE_FONT_SIZE = 15;
static const CGFloat SEGMENT_WIDTH = 48;
static const CGFloat TOGGLE_WIDTH = 52;
static const CGFloat VOLUME_WIDTH = 116;
// downstream echoes every slider step back, so its volume is ignored for a moment after a drag.
static const NSTimeInterval VOLUME_HOLD = 0.5;
// macos's own now playing button takes the control strip's one app slot as playback starts, so the button claims it back after this.
static const NSTimeInterval RECLAIM_DELAY = 1;

// [progress, position, opacity], the same cycle as downstream's scrolling titles.
static const double MARQUEE[8][3] = {{0, 0, 1}, {0.25, 0, 1}, {0.65, 1, 1}, {0.73, 1, 1}, {0.78, 1, 0}, {0.81, 0, 0}, {0.85, 0, 1}, {1, 0, 1}};
// a new song starts scrolling after this short hold.
static const double MARQUEE_FIRST_HOLD = 0.6;

static void emit(NSDictionary *message) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  if (!data) return;
  fwrite(data.bytes, 1, data.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

// an sf symbol where macos has them, otherwise a touch bar glyph.
static NSImage *glyph(NSString *symbol, NSImageName fallback) {
  if (@available(macOS 11.0, *)) {
    NSImage *image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:nil];
    if (image) return image;
  }
  return fallback ? [NSImage imageNamed:fallback] : nil;
}

// downstream's own shuffle and repeat glyphs, drawn at 2x for macos to tint.
static NSImage *templateImage(NSString *base64) {
  if (![base64 isKindOfClass:NSString.class]) return nil;
  NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
  NSImage *image = data ? [[NSImage alloc] initWithData:data] : nil;
  if (!image) return nil;
  image.size = NSMakeSize(image.size.width / 2, image.size.height / 2);
  image.template = YES;
  return image;
}

static BOOL flag(id value) {
  return [value respondsToSelector:@selector(boolValue)] && [value boolValue];
}

// a fixed-width title that scrolls when it doesn't fit, like downstream's own.
@interface TitleView : NSView
- (void)setText:(NSString *)text slide:(BOOL)slide;
@end

@implementation TitleView {
  CATextLayer *_text;
  NSLayoutConstraint *_width;
  NSString *_shown;
  BOOL _slides;
  // how far the title scrolls, 0 when it fits or sliding is off.
  CGFloat _distance;
}

- (instancetype)init {
  self = [super initWithFrame:NSMakeRect(0, 0, TITLE_WIDTH, 30)];
  self.wantsLayer = YES;
  self.layer.masksToBounds = YES;
  NSFont *font = [NSFont systemFontOfSize:TITLE_FONT_SIZE];
  _text = [CATextLayer layer];
  _text.font = (__bridge CFTypeRef)font;
  _text.fontSize = TITLE_FONT_SIZE;
  _text.foregroundColor = [NSColor colorWithWhite:192 / 255.0 alpha:1].CGColor;
  _text.truncationMode = kCATruncationEnd;
  _text.contentsScale = 2;
  _text.anchorPoint = CGPointZero;
  [self.layer addSublayer:_text];
  _width = [self.widthAnchor constraintEqualToConstant:TITLE_WIDTH];
  _width.active = YES;
  return self;
}

- (void)setText:(NSString *)text slide:(BOOL)slide {
  if ([text isEqualToString:_shown] && slide == _slides) return;
  _shown = text;
  _slides = slide;
  NSFont *font = [NSFont systemFontOfSize:TITLE_FONT_SIZE];
  CGFloat full = ceil([text sizeWithAttributes:@{ NSFontAttributeName: font }].width);
  _distance = slide && full > TITLE_WIDTH ? full - TITLE_WIDTH : 0;
  _width.constant = MIN(full, TITLE_WIDTH);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _text.string = text;
  // a title that doesn't scroll is cut short with an ellipsis instead.
  _text.bounds = CGRectMake(0, 0, _distance ? full : MIN(full, TITLE_WIDTH), ceil(font.ascender - font.descender));
  [CATransaction commit];
  [self scroll];
  self.needsLayout = YES;
}

// macos drops layer animations when the bar opens, so scrolling starts over each time it does.
- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self scroll];
}

- (void)scroll {
  [_text removeAnimationForKey:@"marquee"];
  if (!_distance || !self.window) return;
  CGFloat distance = _distance;
  // the same pace as downstream's scrolling titles.
  CFTimeInterval cycle = distance / 6 + 16;
  NSMutableArray *times = [NSMutableArray array];
  NSMutableArray *moves = [NSMutableArray array];
  NSMutableArray *fades = [NSMutableArray array];
  for (int i = 0; i < 8; i++) {
    [times addObject:@(MARQUEE[i][0])];
    [moves addObject:@(-MARQUEE[i][1] * distance)];
    [fades addObject:@(MARQUEE[i][2])];
  }
  CAKeyframeAnimation *move = [CAKeyframeAnimation animationWithKeyPath:@"transform.translation.x"];
  move.values = moves;
  move.keyTimes = times;
  move.duration = cycle;
  CAKeyframeAnimation *fade = [CAKeyframeAnimation animationWithKeyPath:@"opacity"];
  fade.values = fades;
  fade.keyTimes = times;
  fade.duration = cycle;
  CAAnimationGroup *marquee = [CAAnimationGroup animation];
  marquee.animations = @[move, fade];
  marquee.duration = cycle;
  marquee.repeatCount = HUGE_VALF;
  // a new song skips most of the first hold.
  marquee.timeOffset = MARQUEE[1][0] * cycle - MARQUEE_FIRST_HOLD;
  [_text addAnimation:marquee forKey:@"marquee"];
}

- (void)layout {
  [super layout];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _text.position = CGPointMake(0, round((self.bounds.size.height - _text.bounds.size.height) / 2));
  [CATransaction commit];
}

@end

// the button in the control strip, and the player bar it opens over whatever app is in front.
@interface Strip : NSObject <NSTouchBarDelegate>
- (void)receive:(NSDictionary *)message;
- (void)quit;
@end

@implementation Strip {
  NSTouchBar *_bar;
  NSCustomTouchBarItem *_button;
  NSDictionary<NSTouchBarItemIdentifier, NSTouchBarItem *> *_items;
  NSSegmentedControl *_transport;
  TitleView *_title;
  NSSliderTouchBarItem *_volume;
  NSButton *_shuffle;
  NSButton *_repeat;
  NSColor *_toggleOn;
  NSDate *_volumeMoved;
  NSString *_track;
  BOOL _playing;
  // there's music, so the button belongs in the control strip.
  BOOL _shown;
  // downstream is in front with its own bar, so the button waits until it isn't.
  BOOL _focused;
  // the button is showing in the control strip right now.
  BOOL _present;
  // the bar was opened from the button and hasn't been closed yet.
  BOOL _pinned;
  // the bar is being put away for downstream's own bar, not closed by the person.
  BOOL _puttingAway;
}

- (instancetype)init {
  self = [super init];
  // dim teal for toggles that are on, matching downstream's own bar.
  _toggleOn = [NSColor colorWithSRGBRed:0x16 / 255.0 green:0x3c / 255.0 blue:0x38 / 255.0 alpha:1];

  NSButton *open = [NSButton buttonWithImage:glyph(@"music.note", NSImageNameTouchBarAudioOutputVolumeHighTemplate) target:self action:@selector(open)];
  open.accessibilityLabel = @"Downstream player";
  _button = [[NSCustomTouchBarItem alloc] initWithIdentifier:STRIP];
  _button.view = open;

  _transport = [NSSegmentedControl segmentedControlWithImages:@[
    [NSImage imageNamed:NSImageNameTouchBarSkipBackTemplate],
    [NSImage imageNamed:NSImageNameTouchBarPlayTemplate],
    [NSImage imageNamed:NSImageNameTouchBarSkipAheadTemplate],
  ] trackingMode:NSSegmentSwitchTrackingMomentary target:self action:@selector(transport:)];
  for (NSInteger segment = 0; segment < _transport.segmentCount; segment++) {
    [_transport setWidth:SEGMENT_WIDTH forSegment:segment];
  }

  _title = [TitleView new];

  _volume = [[NSSliderTouchBarItem alloc] initWithIdentifier:VOLUME];
  if (@available(macOS 10.15, *)) {
    _volume.maximumSliderWidth = VOLUME_WIDTH;
    _volume.minimumSliderWidth = VOLUME_WIDTH;
  } else {
    // before catalina the slider's width comes from a constraint.
    [_volume.slider.widthAnchor constraintEqualToConstant:VOLUME_WIDTH].active = YES;
  }
  _volume.slider.minValue = 0;
  _volume.slider.maxValue = 100;
  _volume.slider.continuous = YES;
  // one speaker marks it as volume, leaving the room for the slider.
  _volume.minimumValueAccessory = [NSSliderAccessory accessoryWithImage:[NSImage imageNamed:NSImageNameTouchBarAudioOutputVolumeMediumTemplate]];
  _volume.target = self;
  _volume.action = @selector(volumeMoved);

  _shuffle = [self toggle:@"Shuffle" symbol:@"shuffle" action:@selector(shuffle)];
  _repeat = [self toggle:@"Repeat" symbol:@"repeat" action:@selector(repeat)];

  NSMutableDictionary<NSTouchBarItemIdentifier, NSTouchBarItem *> *items = [NSMutableDictionary dictionaryWithObject:_volume forKey:VOLUME];
  NSDictionary *views = @{ TRANSPORT: _transport, TITLE: _title, SHUFFLE: _shuffle, REPEAT: _repeat };
  for (NSTouchBarItemIdentifier identifier in views) {
    NSCustomTouchBarItem *item = [[NSCustomTouchBarItem alloc] initWithIdentifier:identifier];
    item.view = views[identifier];
    items[identifier] = item;
  }
  // the title gives way first when the bar runs out of room.
  items[TITLE].visibilityPriority = NSTouchBarItemPriorityLow;
  _items = items;

  _bar = [NSTouchBar new];
  _bar.delegate = self;
  [_bar addObserver:self forKeyPath:@"visible" options:0 context:NULL];
  return self;
}

- (NSButton *)toggle:(NSString *)label symbol:(NSString *)symbol action:(SEL)action {
  NSButton *button = [NSButton buttonWithTitle:label target:self action:action];
  NSImage *image = glyph(symbol, nil);
  if (image) {
    button.image = image;
    button.imagePosition = NSImageOnly;
  }
  button.accessibilityLabel = label;
  [button.widthAnchor constraintEqualToConstant:TOGGLE_WIDTH].active = YES;
  return button;
}

- (NSTouchBarItem *)touchBar:(NSTouchBar *)touchBar makeItemForIdentifier:(NSTouchBarItemIdentifier)identifier {
  return _items[identifier];
}

- (void)receive:(NSDictionary *)message {
  NSString *type = message[@"type"];
  if ([type isEqual:@"state"]) [self apply:message];
  else if ([type isEqual:@"icons"]) [self setIcons:message];
  else if ([type isEqual:@"focus"]) [self setFocused:flag(message[@"focused"])];
}

- (void)apply:(NSDictionary *)state {
  NSDictionary *music = [state[@"music"] isKindOfClass:NSDictionary.class] ? state[@"music"] : nil;
  if (!flag(state[@"show"]) || !music) {
    [self hide];
    return;
  }
  NSDictionary *items = [state[@"items"] isKindOfClass:NSDictionary.class] ? state[@"items"] : @{};
  NSString *title = [music[@"title"] isKindOfClass:NSString.class] ? music[@"title"] : @"";
  BOOL playing = flag(music[@"playing"]);

  [_transport setImage:[NSImage imageNamed:playing ? NSImageNameTouchBarPauseTemplate : NSImageNameTouchBarPlayTemplate] forSegment:1];
  [_title setText:title slide:flag(music[@"slide"])];
  if (!_volumeMoved || -_volumeMoved.timeIntervalSinceNow > VOLUME_HOLD) {
    _volume.slider.doubleValue = [music[@"volume"] doubleValue];
  }
  _shuffle.bezelColor = flag(music[@"shuffle"]) ? _toggleOn : nil;
  _repeat.bezelColor = flag(music[@"repeat"]) ? _toggleOn : nil;

  // the same optional items as downstream's own player bar.
  NSMutableArray *identifiers = [NSMutableArray arrayWithObject:TRANSPORT];
  if (flag(items[@"title"])) [identifiers addObject:TITLE];
  [identifiers addObject:NSTouchBarItemIdentifierFlexibleSpace];
  if (flag(items[@"volume"])) [identifiers addObject:VOLUME];
  if (flag(items[@"shuffleRepeat"])) [identifiers addObjectsFromArray:@[SHUFFLE, REPEAT]];
  if (![identifiers isEqualToArray:_bar.defaultItemIdentifiers]) _bar.defaultItemIdentifiers = identifiers;

  if (!_shown) {
    _shown = YES;
    [NSTouchBarItem addSystemTrayItem:_button];
    [self updateButton];
  }

  if ((playing && !_playing) || ![title isEqualToString:_track]) {
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(reclaim) object:nil];
    [self performSelector:@selector(reclaim) withObject:nil afterDelay:RECLAIM_DELAY];
  }
  _playing = playing;
  _track = title;
}

- (void)reclaim {
  if (_present) setStripPresence(STRIP, YES);
}

// showing the button claims the control strip's app slot, so it only happens when the button actually comes back.
- (void)updateButton {
  BOOL present = _shown && !_focused;
  if (present == _present) return;
  _present = present;
  setStripPresence(STRIP, present);
}

- (void)setIcons:(NSDictionary *)icons {
  NSImage *shuffle = templateImage(icons[@"shuffle"]);
  NSImage *repeat = templateImage(icons[@"repeat"]);
  if (shuffle) {
    _shuffle.image = shuffle;
    _shuffle.imagePosition = NSImageOnly;
  }
  if (repeat) {
    _repeat.image = repeat;
    _repeat.imagePosition = NSImageOnly;
  }
}

- (void)hide {
  if (!_shown) return;
  _shown = NO;
  _pinned = NO;
  _playing = NO;
  _track = nil;
  [self putAway];
  [self updateButton];
  [NSTouchBarItem removeSystemTrayItem:_button];
}

- (void)present {
  _puttingAway = NO;
  [NSTouchBar presentSystemModalTouchBar:_bar systemTrayItemIdentifier:STRIP];
}

- (void)putAway {
  if (!_bar.isVisible) return;
  _puttingAway = YES;
  [NSTouchBar dismissSystemModalTouchBar:_bar];
}

// the bar stays up across apps until it's closed.
// while downstream's own bar is showing, the bar and its button both step aside.
- (void)setFocused:(BOOL)focused {
  _focused = focused;
  if (focused) [self putAway];
  [self updateButton];
  if (!focused && _pinned && _shown && !_bar.isVisible) [self present];
}

- (void)open {
  _pinned = YES;
  [self present];
  emit(@{ @"event": @"opened" });
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if (_bar.isVisible) return;
  if (_puttingAway) {
    _puttingAway = NO;
  } else if (_pinned) {
    _pinned = NO;
    emit(@{ @"event": @"closed" });
  }
}

- (void)transport:(NSSegmentedControl *)control {
  NSArray *actions = @[@"prev", @"play-pause", @"next"];
  NSInteger segment = control.selectedSegment;
  if (segment >= 0 && segment < (NSInteger)actions.count) emit(@{ @"action": actions[segment] });
}

- (void)volumeMoved {
  _volumeMoved = [NSDate date];
  emit(@{ @"action": @"volume", @"value": @(lround(_volume.slider.doubleValue)) });
}

- (void)shuffle {
  emit(@{ @"action": @"shuffle" });
}

- (void)repeat {
  emit(@{ @"action": @"repeat" });
}

- (void)quit {
  [self hide];
  exit(0);
}

@end

// reads downstream's messages, and quits once downstream closes the pipe.
static void readMessages(Strip *strip) {
  NSMutableData *pending = [NSMutableData data];
  NSFileHandle.fileHandleWithStandardInput.readabilityHandler = ^(NSFileHandle *input) {
    NSData *chunk = input.availableData;
    if (chunk.length == 0) input.readabilityHandler = nil;
    dispatch_async(dispatch_get_main_queue(), ^{
      if (chunk.length == 0) {
        [strip quit];
        return;
      }
      [pending appendData:chunk];
      const char *bytes = pending.bytes;
      NSUInteger start = 0;
      for (NSUInteger i = 0; i < pending.length; i++) {
        if (bytes[i] != '\n') continue;
        id message = [NSJSONSerialization JSONObjectWithData:[pending subdataWithRange:NSMakeRange(start, i - start)] options:0 error:nil];
        start = i + 1;
        if ([message isKindOfClass:NSDictionary.class]) [strip receive:message];
      }
      [pending replaceBytesInRange:NSMakeRange(0, start) withBytes:NULL length:0];
    });
  };
}

int main(void) {
  @autoreleasepool {
    // a write after downstream has gone is ignored, and the closed pipe ends the helper.
    signal(SIGPIPE, SIG_IGN);

    void *dfr = dlopen("/System/Library/PrivateFrameworks/DFRFoundation.framework/DFRFoundation", RTLD_LAZY);
    setStripPresence = dfr ? dlsym(dfr, "DFRElementSetControlStripPresenceForIdentifier") : NULL;
    showCloseBox = dfr ? dlsym(dfr, "DFRSystemModalShowsCloseBoxWhenFrontMost") : NULL;
    BOOL supported = setStripPresence && showCloseBox
      && [NSTouchBarItem respondsToSelector:@selector(addSystemTrayItem:)]
      && [NSTouchBarItem respondsToSelector:@selector(removeSystemTrayItem:)]
      && [NSTouchBar respondsToSelector:@selector(presentSystemModalTouchBar:systemTrayItemIdentifier:)]
      && [NSTouchBar respondsToSelector:@selector(dismissSystemModalTouchBar:)];
    if (!supported) {
      emit(@{ @"event": @"unavailable", @"reason": @"this version of macos has no control strip api" });
      return 0;
    }

    NSApplication *app = NSApplication.sharedApplication;
    // no dock icon or menu bar, only the touch bar.
    app.activationPolicy = NSApplicationActivationPolicyAccessory;
    // app nap would stall replies to downstream while another app is in front.
    id<NSObject> activity = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep reason:@"Player controls in the Control Strip"];
    showCloseBox(YES);

    Strip *strip = [Strip new];
    readMessages(strip);
    emit(@{ @"event": @"ready" });
    [app run];
    [NSProcessInfo.processInfo endActivity:activity];
  }
  return 0;
}
