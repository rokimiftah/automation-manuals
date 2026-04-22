# GuardLogix 5570 Controllers

Catalog Numbers 1756-L71S, 1756-L72S, 1756-L73S, 1756-L7SP, 1756-L73SXT, 1756-L7SPXT, Catalog Numbers 1756-L71S, 1756-

![image](https://cdn-mineru.openxlab.org.cn/result/2026-04-22/efea7867-108b-4a95-af25-35c1cd779776/78d03893f36bad22cb0d205f1d099cd72bec81d193f71c8e2383eea961a680f9.jpg)

![image](https://cdn-mineru.openxlab.org.cn/result/2026-04-22/efea7867-108b-4a95-af25-35c1cd779776/f6a662f67740abb1645b27465439bc9d60fa57e96fda6c2fdbce2b55bc526bcc.jpg)

![image](https://cdn-mineru.openxlab.org.cn/result/2026-04-22/efea7867-108b-4a95-af25-35c1cd779776/da783e85c3bbc93f297d58aecf5225108f4896c02776e979b50291c3a082ea28.jpg)

![image](https://cdn-mineru.openxlab.org.cn/result/2026-04-22/efea7867-108b-4a95-af25-35c1cd779776/99e0621328129988982f8ae3403f92008c139898335e727b2b77e21a76be17d2.jpg)

# Important User Information

Read this document and the documents listed in the additional resources section about installation, configuration, and operation of this equipment before you install, configure, operate, or maintain this product. Users are required to familiarize themselves with installation and wiring instructions in addition to requirements of all applicable codes, laws, and standards.

Activities including installation, adjustments, putting into service, use, assembly, disassembly, and maintenance are required to be carried out by suitably trained personnel in accordance with applicable code of practice.

If this equipment is used in a manner not specified by the manufacturer, the protection provided by the equipment may be impaired.

In no event will Rockwell Automation, Inc. be responsible or liable for indirect or consequential damages resulting from the use or application of this equipment.

The examples and diagrams in this manual are included solely for illustrative purposes. Because of the many variables and requirements associated with any particular installation, Rockwell Automation, Inc. cannot assume responsibility or liability for actual use based on the examples and diagrams.

No patent liability is assumed by Rockwell Automation, Inc. with respect to use of information, circuits, equipment, or software described in this manual.

Reproduction of the contents of this manual, in whole or in part, without written permission of Rockwell Automation, Inc., is prohibited

Throughout this manual, when necessary, we use notes to make you aware of safety considerations.

<table><tr><td>!</td><td>WARNING: Identifies information about practices or circumstances that can cause an explosion in a hazardous environment, which may lead to personal injury or death, property damage, or economic loss.</td></tr><tr><td>!</td><td>ATTENTION: Identifies information about practices or circumstances that can lead to personal injury or death, property damage, or economic loss. Attentions help you identify a hazard, avoid a hazard, and recognize the consequence.</td></tr><tr><td>IMPORTANT</td><td>Identifies information that is critical for successful application and understanding of the product.</td></tr><tr><td colspan="2">Labels may also be on or inside the equipment to provide specific precautions.</td></tr><tr><td></td><td>SHOCK HAZARD: Labels may be on or inside the equipment, for example, a drive or motor, to alert people that dangerous voltage may be present.</td></tr><tr><td></td><td>BURN HAZARD: Labels may be on or inside the equipment, for example, a drive or motor, to alert people that surfaces may reach dangerous temperatures.</td></tr><tr><td></td><td>ARC FLASH HAZARD: Labels may be on or inside the equipment, for example, a motor control center, to alert people to potential Arc Flash. Arc Flash will cause severe injury or death. Wear proper Personal Protective Equipment (PPE). Follow ALL Regulatory requirements for safe work practices and for Personal Protective Equipment (PPE).</td></tr></table>

# Preface . . . . . . . .

Summary of Changes . . . . 9

About GuardLogix Controllers . . . . . 10

Extreme Environment Controllers . . . . . 10

Armor GuardLogix Controllers. . . . . 10

Terminology . . . . . 11

Additional Resources . . 11

# Chapter 1

# System Overview

Safety Application Requirements . . . . . 13

Safety Network Number . . . 14

Safety Task Signature . . . 14

Distinguish between Standard and Safety Components . . . . . . . . . . . 14

HMI Devices. . . 15

Controller Data-flow Capabilities . . . . . 15

Select System Hardware . . . 16

Primary Controller . . . 16

Safety Partner . . . 17

Chassis . . . 17

Power Supply . . . . 17

Select Safety I/O Device . . . . 17

Select Communication Networks. . . . 18

Programming Requirements . . . . 19

# Install the Controller

# Chapter 2

Precautions . . 21

European Hazardous Location Approval . . . . . . 24

Make Sure That You Have All of the Components. . . . . . . . . . . 25

Install a Chassis and Power Supply . . . . . 26

Install the Controller Into the Chassis . . . . . . 27

Insert or Remove a Memory Card . . . . . 28

Remove the SD Card . . . . 29

Install the SD Card . . . . 30

Make Communication Connections . . . . . . . . . 31

Update the Controller . . . . . . 33

Using ControlFLASH Software to Update Firmware. . . . . . . . . 33

Using AutoFlash to Update Firmware . . . . . 38

Choose the Operating Mode of the Controller. . . . . . . . . 40

Use the Key Switch to Change the Operation Mode . . . . . . . . . . 41

Use the Logix Designer Application to Change the Operation Mode . . 41

Uninstall an Energy Storage Module (ESM) . . . . . . . . 42

Install an Energy Storage Module (ESM) . . . . . . 44

# Configure the Controller

# Chapter 3

Create a Controller Project . . . . . . 47

Electronic Keying . . . . 50

Set Passwords for Safety-locking and -unlocking . . . . . . . . . . . 51

Protect the Safety Task Signature in Run Mode . . . . . . . 52

Handling I/O Device Replacement . . . 53

Enable Time Synchronization . . . . . 54

Configure a Peer Safety Controller. . . . . 55

# Communicate over Networks

# Chapter 4

The Safety Network . . . . . . 57

Manage the Safety Network Number (SNN). . . . . . . . . . . . . . . . . 57

Assign the Safety Network Number (SNN) . . . . . . . 59

Change the Safety Network Number (SNN). . . . . . 60

EtherNet/IP Communication. . . 65

Producing and Consuming Data via an

EtherNet/IP Network . . . 66

Connections over the EtherNet/IP Network . . . . . . . . . . . . . . . . 66

EtherNet/IP Communication Examples. . . . . . . . . 67

EtherNet/IP Connections for Safety I/O Devices . . . . . . . . . . . . 69

Standard EtherNet/IP Connections. . . . 69

ControlNet Communication . . . . . . . 70

Producing and Consuming Data via a ControlNet Network . . 71

Connections over the ControlNet Network . . . . . . . . . . . . 71

ControlNet Communication Example . . . . . . . . 72

ControlNet Connections for Distributed I/O . . . . . . . . . . . 72

DeviceNet Communication. . . . 73

DeviceNet Connections for Safety I/O Devices . . . . . . . . . . . . . . 73

Standard DeviceNet Connections. . . . . . 74

# Add, Configure, Monitor, and Replace CIP Safety I/O Devices

# Chapter 5

Add Safety I/O Devices . . . . . . 75

Configure Safety I/O Devices . . . . . . 76

Set the IP Address by Using Network Address Translation

(NAT) . . . 78

Set the Safety Network Number (SNN) . . . . . . . 79

Use Unicast Connections on EtherNet/IP Networks. . . . . . . . . . . . . 79

Set the Connection Reaction Time Limit . . . . . . 79

Specify the Requested Packet Interval (RPI) . . . . . . 80

View the Maximum Observed Network Delay . . . . . . . . . . . . . . . 81

Set the Advanced Connection Reaction Time Limit

Parameters . 82

Understanding the Configuration Signature . . . . . . . . 85

Configuration via the Logix Designer Application . . . . . . . . . . . . 85

Different Configuration Owner (listen-only connection) . . . . . 85

Reset Safety I/O Device Ownership. . . . . . 86

Address Safety I/O Data . . . . . . 86

Safety I/O Modules Address Format . . . . . . . . 86

Kinetix 5500, Kinetix 5700, and PowerFlex 527 Drive Address Format . . 87

Monitor Safety I/O Device Status . . . . . 88

Reset a Module to Out-of-box Condition . . . . . 89

Replace a Device by Using the Logix Designer Application. . . . . . . . 90

Replacement with ‘Configure Only When No Safety Signature Exists’ Enabled . . . 91

Replacement with ‘Configure Always’ Enabled . . . . . . . . . . . . . . . 96

Replace a POINT Guard I/O Module by Using RSNetWorx

for DeviceNet Software . . . . . 97

# Chapter 6

The Safety Task . . . . 102

Safety Task Period Specification . . . . . 102

Safety Task Execution. . . . . 103

Safety Programs . . . . . . 103

Safety Routines . . . . . 104

Safety Tags . . . 104

Tag Type . . . . 105

Data Type . . . . . 106

Scope . . . . . . 107

Class . . 108

Constant Value. . . . 108

External Access . . . 108

Produced/Consumed Safety Tags. . . . . . . . 109

Configure the Peer Safety Controllers’ Safety Network Numbers. . . 109

Produce a Safety Tag . . . . . . 112

Consume Safety Tag Data . . . . . . 113

Safety Tag Mapping . . . . . . 116

Restrictions . . . 116

Create Tag Mapping Pairs . . . . . 117

Monitor Tag Mapping Status . . . . . 118

Safety Application Protection . . . . 118

Safety-lock the Controller . . . . 118

Generate a Safety Task Signature. . . . . . . 120

Programming Restrictions . . . . . . 122

# Develop Safety Applications

# Go Online with the Controller

# Chapter 7

Connect the Controller to the Network. . . . . . . . . 125

Connect Your EtherNet/IP Device and Computer . . . . . . . . . . 126

Connect Your ControlNet Communication Module or DeviceNet Scanner and Your Computer . . . . . . . . . . 126

Configure an EtherNet/IP, ControlNet, or DeviceNet Driver. . 126

Understanding the Factors that Affect Going Online. . . . . . . . . . . . 127

Project to Controller Matching . . . . . . . 127

Firmware Revision Matching . . . . . 127

Safety Status/Faults . . . . . . 127

Safety Task Signature and Safety-locked and -unlocked Status . . . . . . . 128

Download . . . . 129

Upload . . . . 130

Go Online . . . . 132

# Store and Load Projects Using Nonvolatile Memory

# Chapter 8

Use Memory Cards for Nonvolatile Memory . . . . . . . 135

Store a Safety Project . . . . . . 136

Load a Safety Project . . . . . . 137

Use Energy Storage Modules . . . . . . 138

Save the Program to On-board NVS Memory . . . . . . . . . . 138

Clear the Program from On-board NVS Memory . . . . . . . . . . . 139

Estimate the ESM Support of the WallClockTime . . . . . . . . . . . . . . 140

Manage Firmware with Firmware Supervisor . . . . . . . 140

# Monitor Status and Handle Faults

# Chapter 9

View Status via the Online Bar . . . . . . 141

Monitor the Connections. . . 142

All Connections . . . . . . 142

Safety Connections . . . . . 143

Monitor the Status Flags . . . . . 143

Monitor the Safety Status . . . . . 144

Controller Faults . . . . 145

Nonrecoverable Controller Faults. . . . . . . 145

Nonrecoverable Safety Faults in the Safety Application . . . . . . 145

Recoverable Faults in the Safety Application . . . . . . . . . . . 145

View Faults . . . . . 146

Fault Codes . . . . 146

Developing a Fault Routine . . . . . . 147

Program Fault Routine. . . . . . 147

Controller Fault Handler . . . . . . 147

Use GSV/SSV Instructions . . . . . 148

# Status Indicators

# Appendix A

Controllers Status Indicators . . . . 151

Controller Status Display . . . . . . . 152

Safety Status Messages . . . . . . 152

General Status Messages. . . . . . . 153

Fault Messages . . . . . 154

Major Recoverable Fault Messages . . . . . . 155

I/O Fault Codes . . . . 157

# Change Controller Type

# Appendix B

Change from a Standard to a Safety Controller . . . . . . . . 159

Change from a Safety to a Standard Controller . . . . . . . . . 160

Change Safety Controller Types . . . . . . . . 161

Index . . . . . . 163

<table><tr><td>Topic</td><td>Page</td></tr><tr><td>Summary of Changes</td><td>9</td></tr><tr><td>About GuardLogix Controllers</td><td>10</td></tr><tr><td>Terminology</td><td>11</td></tr><tr><td>Additional Resources</td><td>11</td></tr></table>

This manual is a guide for when a GuardLogix® 5570 controller is used in a Studio 5000 Logix Designer® application. It describes the GuardLogix-specific procedures that you use to configure, operate, and troubleshoot your controller.

Use this manual if you are responsible for the design, installation, programming, or troubleshooting of control systems with GuardLogix 5570 controllers.

You must have a basic understanding of electrical circuitry and familiarity with relay logic. You must also be trained and experienced in the creation, operation, and maintenance of safety systems.

For detailed information on related topics for GuardLogix controller, Safety Integrity Level (SIL) 3 and Performance Level (e) (SIL 3/PLe) requirements, or information on standard Logix components, see the list of Additional Resources on page 11.

# Summary of Changes

We added the 1756-L72EROMS and 1756-L73EROMS Armor™ GuardLogix controllers to this user manual.

# About GuardLogix Controllers

Two lines of 1756 GuardLogix controllers are available. These controllers share many features but also have some differences. Table 1 provides a brief overview of those differences.

Table 1 - Differences between GuardLogix 5570 and GuardLogix 5560 Controllers

<table><tr><td>Feature</td><td>GuardLogix 5570 Controllers(1756-L71S, 1756-L72S, 1756-L72EROMS, 1756-L73S, 1756-L73EROMS, 1756-L7SP, 1756-L73SXT, 1756-L7SPXT)</td><td>GuardLogix 5560 Controllers(1756-L61S, 1756-L62S, 1756-L63S, 1756-LSP)</td></tr><tr><td>Clock support and backup that is used for memory retention at powerdown</td><td>Energy storage module (ESM)</td><td>Battery</td></tr><tr><td>Communication ports (built-in)</td><td>USB</td><td>Serial</td></tr><tr><td>Connections, controller</td><td>500</td><td>250</td></tr><tr><td>Memory, nonvolatile</td><td>Secure Digital (SD) card</td><td>CompactFlash (CF) card</td></tr><tr><td>Status indicators</td><td>Scrolling status display and status indicators</td><td>Status indicators</td></tr><tr><td>Programming tool</td><td>Studio 5000® environment, version 21 or laterRSLogix 5000 software, version 20 or later</td><td>RSLogix 5000® software, version 14RSLogix 5000 software, version 16or later</td></tr><tr><td>User manual</td><td>• Studio 5000 environment: this manual• RSLogix 5000 software: 1756-UM020</td><td>1756-UM020</td></tr><tr><td>Safety reference manual</td><td>• Studio 5000 environment: 1756-RM099• RSLogix 5000 software: 1756-RM093</td><td>1756-RM093</td></tr></table>

# Extreme Environment Controllers

The extreme environment GuardLogix controller, catalog numbers 1756-L73SXT and 1756-L7SPXT, provide the same functionality as the 1756-L73S controller, but is designed to withstand temperatures of $- 2 5 . . . + 7 0 ^ { \circ } \mathrm { C }$ ( $1 3 . . . + 1 5 8 ^ { \circ } \mathrm { F } )$ .

# IMPORTANT

Logix-XT system components are rated for extreme environmental conditions only when used properly with other Logix-XT system components. The use of Logix-XT components with traditional Logix system components nullifies extreme-environment ratings.

# Armor GuardLogix Controllers

The Armor™ GuardLogix controllers (catalog numbers 1756-L72EROMS and 1756-L73EROMS) combine a 1756-L72S or 1756-L73S GuardLogix controller and safety partner with two EtherNet/IP™, DLR-capable communication channels in an IP67-rated housing for mounting on a machine. For more information on the Armor GuardLogix controller, refer to the Armor GuardLogix Controller Installation Instructions, publication 1756-IN060.

Though the 1756-L72EROMS and 1756-L73EROMS controllers have functionality identical to that of the 1756-L72S and 1756-L73S controllers,

the Armor controller energy storage modules (ESM) cannot be removed or replaced.

# Terminology

This table defines terms that are used in this manual.

Table 2 - Terms and Definitions

<table><tr><td>Abbreviation</td><td>Full Term</td><td>Definition</td></tr><tr><td>1oo2</td><td>One Out of Two</td><td>Refers to the behavioral design of a multi-processor safety system.</td></tr><tr><td>CIP™</td><td>Common Industrial Protocol</td><td>A communication protocol that is designed for industrial automation applications.</td></tr><tr><td>CIP Safety™</td><td>Common Industrial Protocol – Safety Certified</td><td>SIL 3/PLe-rated version of CIP.</td></tr><tr><td>DC</td><td>Diagnostic Coverage</td><td>The ratio of the detected failure rate to the total failure rate.</td></tr><tr><td>EN</td><td>European Norm</td><td>The official European standard.</td></tr><tr><td>ESM</td><td>Energy Storage Module</td><td>Used for clock support and backup for memory retention at powerdown on GuardLogix 5570 controllers.</td></tr><tr><td>GSV</td><td>Get System Value</td><td>An instruction that retrieves specified controller-status information and places it in a destination tag.</td></tr><tr><td>—</td><td>Multicast</td><td>The transmission of information from one sender to multiple receivers.</td></tr><tr><td>NAT</td><td>Network Address Translation</td><td>The translation of an Internet Protocol (IP) address to another IP address on another network.</td></tr><tr><td>PFD</td><td>Probability of Failure on Demand</td><td>The average probability of a system to fail to perform its design function on demand.</td></tr><tr><td>PFH</td><td>Probability of Failure per Hour</td><td>The probability of a system to have a dangerous failure occur per hour.</td></tr><tr><td>PL</td><td>Performance Level</td><td>ISO 13849-1 safety rating.</td></tr><tr><td>RPI</td><td>Requested Packet Interval</td><td>The expected rate in time for production of data when communicating over a network.</td></tr><tr><td>SNN</td><td>Safety Network Number</td><td>A unique number that identifies a section of a safety network.</td></tr><tr><td>SSV</td><td>Set System Value</td><td>An instruction that sets controller system data.</td></tr><tr><td>—</td><td>Standard</td><td>An object, task, tag, program, or component in your project that is not a safety-related item.</td></tr><tr><td>—</td><td>Unicast</td><td>The transmission of information from one sender to one receiver.</td></tr></table>

# Additional Resources

These documents contain more information about related products from Rockwell Automation.You can view or download publications at

Table 3 - Publications Related to GuardLogix Controllers and Systems

<table><tr><td colspan="2">Resource</td><td>Description</td></tr><tr><td rowspan="2">Safety application requirements</td><td>GuardLogix 5570 and Compact GuardLogix 5370 Controller Systems Safety Reference Manual, publication 1756-RM099</td><td>Contains detailed requirements for achieving and maintaining SIL 3/Plc with the GuardLogix 5570 controller system, using the Studio 5000 Logix Designer application.</td></tr><tr><td>GuardLogix Controller Systems Safety Reference Manual, publication 1756-RM093</td><td>Contains detailed requirements for achieving and maintaining SIL 3/Plc with the GuardLogix 5560 or 5570 controller system, using RSLogix 5000 software.</td></tr><tr><td>CIP SyncTM (time synchronization)</td><td>Integrated Architecture® and CIP Sync Configuration Application Technique, publication IA-AT003</td><td>Provides detailed and comprehensive information about how to apply CIP Sync technology to synchronize clocks in a Logix control system.</td></tr><tr><td rowspan="4">Guard I/O™ modules</td><td>Guard I/O DeviceNet™ Safety Modules User Manual, publication 1791DS-UM001</td><td>Provides information on using Guard I/O DeviceNet Safety modules.</td></tr><tr><td>Guard I/O EtherNet/IP Safety Modules User Manual, publication 1791ES-UM001</td><td>Provides information on using Guard I/O EtherNet/IP Safety modules.</td></tr><tr><td>POINT Guard I/O™ Safety Modules User Manual, publication 1734-UM013</td><td>Provides information on installing, configuring, and using POINT Guard I/O modules.</td></tr><tr><td>Armor GuardLogix Controller Installation Instructions, publication 1756-IN060</td><td>Provides information on installing and using Armor GuardLogix controllers.</td></tr><tr><td rowspan="3">Drives</td><td>Kinetix® 5500 Servo Drives User Manual, publication 2198-UM001</td><td>Provides information to install, configure, start, and troubleshoot your Kinetix 5500 servo drive system. Also includes requirements for using Kinetix 5500 drives in safety applications.</td></tr><tr><td>Kinetix 5700 Servo Drives User Manual, publication 2198-UM002</td><td>Provides information to install, configure, start, and troubleshoot your Kinetix 5700 servo drive system. Also includes requirements for using Kinetix 5700 drives in safety applications.</td></tr><tr><td>PowerFlex® 527 Adjustable Frequency AC Drive User Manual, publication 520-UM002</td><td>Provides information to install, start, and troubleshoot the PowerFlex 520-series adjustable frequency AC drive.</td></tr><tr><td rowspan="2">Hardware installation</td><td>ControlLogix® Chassis and Power Supplies Installation Instructions, publication 1756-IN005</td><td>Describes how to install and ground ControlLogix chassis and power supplies.</td></tr><tr><td>Industrial Automation Wiring and Grounding Guidelines, publication 1770-4.1</td><td>Provides in-depth information on how to ground and wire programmable controllers.</td></tr><tr><td rowspan="3">Instructions (programming)</td><td>GuardLogix Safety Application Instruction Set Reference Manual, publication 1756-RM095</td><td>Provides information on the GuardLogix Safety application instruction set.</td></tr><tr><td>Logix5000 Controllers General Instructions Reference Manual, publication 1756-RM003</td><td>Provides programmers with details about each available instruction for a Logix5000TM controller.</td></tr><tr><td>Logix5000 Controllers Motion Instructions Reference Manual, publication MOTION-RM002</td><td>Provides programmers with details about the motion instructions that are available for a Logix5000 controller.</td></tr><tr><td rowspan="4">Motion</td><td>Seros Motion Configuration and Startup User Manual, publication MOTION-UM001</td><td>Details how to configure a sercos motion application system.</td></tr><tr><td>Motion Coordinated Systems User Manual, publication MOTION-UM002</td><td>Details how to create and configure a coordinated motion application system.</td></tr><tr><td>Integrated Motion on the EtherNet/IP Network Configuration and Startup User Manual, publication MOTION-UM003</td><td>Details how to configure an Integrated Motion on EtherNet/IP networks application system.</td></tr><tr><td>Integrated Motion on the EtherNet/IP Network Reference Manual, publication MOTION-RM003</td><td>Detailed information on axis control modes and attributes for Integrated Motion on EtherNet/IP networks.</td></tr><tr><td rowspan="3">Networks (ControlNet™, DeviceNet™, EtherNet/IP™)</td><td>EtherNet/IP Modules in Logix5000 Control Systems User Manual, publication ENET-UM001</td><td>Describes how to configure and operate EtherNet/IP modules in a Logix5000 control system.</td></tr><tr><td>ControlNet Modules in Logix5000 Control Systems User Manual, publication CNET-UM001</td><td>Describes how to configure and operate ControlNet modules in a Logix5000 control system.</td></tr><tr><td>DeviceNet Modules in Logix5000 Control Systems User Manual, publication DNET-UM004</td><td>Describes how to configure and operate DeviceNet modules in a Logix5000 control system.</td></tr><tr><td>PhaseManagerTM</td><td>PhaseManager User Manual, publication LOGIX-UM001</td><td>Provides steps, guidance, and examples on how to set up and program a Logix5000 controller to use equipment phases.</td></tr><tr><td rowspan="2">Programming tasks and procedures</td><td>Logix5000 Controllers Common Procedures Programming Manual, publication 1756-PM001</td><td>Provides access to the Logix5000 Controllers set of programming manuals, which cover such topics as how to manage project files, organize tags, program logic, test routines, handle faults, and more.</td></tr><tr><td>Logix5000 Controllers Execution Time and Memory Use Reference Manual, publication 1756-RM087</td><td>Helps with how to estimate memory use and execution time of programmed logic, and how to select different programming options.</td></tr></table>

http://www.rockwellautomation.com/literature. To order paper copies of technical documentation, contact your local Allen-Bradley distributor or Rockwell Automation sales representative.

# System Overview

<table><tr><td>Topic</td><td>Page</td></tr><tr><td>Safety Application Requirements</td><td>13</td></tr><tr><td>Distinguish between Standard and Safety Components</td><td>14</td></tr><tr><td>Controller Data-flow Capabilities</td><td>15</td></tr><tr><td>Select System Hardware</td><td>16</td></tr><tr><td>Select Safety I/O Device</td><td>17</td></tr><tr><td>Select Communication Networks</td><td>18</td></tr><tr><td>Programming Requirements</td><td>19</td></tr></table>

# Safety Application Requirements

The GuardLogix® 5570 controller system is certified for use in safety applications up to and including Safety Integrity Level Claim Limit (SIL CL) 3 and Performance Level (e) where the de-energized state is the safe state. Safety application requirements include probability of failure rates evaluation, such as:

• Probability of failure on demand (PFD)

• Probability of failure per hour (PFH)

• System reaction-time settings

• Functional-verification tests that fulfill SIL 3/PLe criteria

GuardLogix-based SIL 3/PLe safety applications require at least one safety network number (SNN) and a safety task signature be used. Both affect controller and I/O configuration and network communication.

For SIL 3 and PLe safety system requirements, including functional validation test intervals, system reaction time, and PFD/PFH calculations, refer to the GuardLogix 5570 and Compact GuardLogix 5370 Controller Systems Safety Reference Manual, publication 1756-RM099. You must read, understand, and fulfill these requirements before you operate a GuardLogix SIL 3, PLe safety system.

# Safety Network Number

The safety network number (SNN) must be a unique number that identifies safety subnets. Each safety subnet that the controller uses for safety communication must have a unique SNN. Each safety I/O device must also be configured with the SNN of the safety subnet. The SNN can be assigned automatically or manually.

For information on how to assign the SNN, see Manage the Safety Network Number (SNN) on page 57.

# Safety Task Signature

The safety task signature consists of an ID number, date, and time that uniquely identifies the safety portion of a project. This signature includes safety logic, data, and configuration. The GuardLogix system uses the safety task signature to determine project integrity and to let you verify that the correct project is downloaded to the target controller. The ability to create, record, and verify the safety task signature is a mandatory part of the safetyapplication development process.

See Generate a Safety Task Signature on page 120 for more information.

# Distinguish between Standard and Safety Components

Slots of a GuardLogix system chassis that are not used by the safety function can be populated with other ControlLogix® modules that are certified to the Low Voltage and EMC Directives. See http://www.rockwellautomation.com/ rockwellautomation/certification/ce.page to find the CE certificate for the Programmable Control>ControlLogix Product Family and determine the modules that are certified.

You must create and document a clear, logical, and visible distinction between the safety and standard portions of the controller project. As part of this distinction, the Logix Designer application features safety identification icons to identify the safety task, safety programs, safety routines, and safety components. In addition, the Logix Designer application uses a safety class attribute that is visible whenever safety task, safety programs, safety routine, safety tag, or safety Add-On Instruction properties are displayed.

The controller does not allow writes to safety tag data from external human machine interface (HMI) devices or via message instructions from peer controllers. The Logix Designer application can write safety tags when the GuardLogix controller is safety-unlocked, does not have a safety task signature, and is operating without safety faults.

The ControlLogix Controllers User Manual, publication 1756-UM001, provides information on using ControlLogix devices in standard (nonsafety) applications.

# HMI Devices

HMI devices can be used with GuardLogix controllers. HMI devices can access standard tags as with a standard controller. However, HMI devices cannot write to safety tags; safety tags are read-only for HMI devices.

# Controller Data-flow Capabilities

This illustration explains the standard and safety data-flow capabilities of the GuardLogix controller.

Figure 1 - Data-flow Capabilities

![image](https://cdn-mineru.openxlab.org.cn/result/2026-04-22/efea7867-108b-4a95-af25-35c1cd779776/a5128e4c1942bcf1e2e59d1b1d76a6c4f1fbabc008119151a19064b58ba5cbcc.jpg)

<table><tr><td>No.</td><td colspan="2">Description</td></tr><tr><td>1</td><td colspan="2">Standard tags and logic behave the same way that they do in the standard Logix platform.</td></tr><tr><td>2</td><td colspan="2">Standard tag data, program- or controller-scoped, can be exchanged with external HMI devices, personal computers, and other controllers.</td></tr><tr><td rowspan="2">3</td><td colspan="2">GuardLogix controllers are integrated controllers with the ability to move (map) standard tag data into safety tags for use within the safety task.</td></tr><tr><td>!</td><td>ATTENTION: These data must not be used to control a SIL 3/PLe output directly.</td></tr><tr><td>4</td><td colspan="2">Controller-scoped safety tags can be read directly by standard logic.</td></tr><tr><td>5</td><td colspan="2">Safety tags can be read or written by safety logic.</td></tr><tr><td>6</td><td colspan="2">Safety tags can be exchanged between safety controllers over Ethernet or ControlNet™ networks, including 1756 and 1768 GuardLogix controllers.</td></tr><tr><td rowspan="2">7</td><td colspan="2">Safety tag data, program- or controller-scoped, can be read by external devices, such as HMI devices, personal computers, or other standard controllers.</td></tr><tr><td>IMPORTANT</td><td>Once this data is read, it is considered standard data, not SIL 3/PLe data.</td></tr></table>
