import subprocess
import json
import math
import sys


FILE_SIZE_LIMIT_IN_BYTES = 8388608 # 8 * 1024 * 1024

def get_file_path():

    return sys.argv[1]


def get_file_name():

    return sys.argv[1].split('\\')[-1]


def get_file_endings(file_name):
    file_names_dict = {
        'video_only': f'{file_name + "_NO_AUD.mp4"}',
        'audio_only': f'{file_name + "_NO_VID.mp4"}',
        'rescaled': f'{file_name + "_RESCALED.mp4"}',
        'changed_bitrate': f'{file_name + "_CHANGED_BITRATE.mp4"}',
        '8mb': '_8MB.mp4',
        'original': file_name
    }

    return file_names_dict


def split_video(file_path, output):
    subprocess.run(f'.\\ffmpeg.exe -i "{file_path}" -y -c:v copy -an ".\\tmp\\{output["video_only"]}" -c:a copy -vn ".\\tmp\\{output["audio_only"]}"')


def get_metadata(file_name):
    stdout = subprocess.run(f'.\\ffprobe.exe -i ".\\tmp\\{file_name}" -v quiet -print_format json -show_streams -show_format', capture_output=True, encoding='UTF-8').stdout
    metadata_json = json.loads(stdout)

    return metadata_json


def rescale_video(file_name, output, video_metadata):
    if {video_metadata['streams'][0]['width'], video_metadata['streams'][0]['height']}.issubset({1920, 1080}):
        subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_name}" -y -s 1280x720 ".\\tmp\\{output}"')


def determine_target_bitrate(video_metadata, audio_metadata):
    reduction_coeff = int(video_metadata['format']['size']) / (FILE_SIZE_LIMIT_IN_BYTES - int(audio_metadata['format']['size']))
    target_bitrate = int(video_metadata['streams'][0]['bit_rate']) / math.ceil(reduction_coeff)

    return target_bitrate


def process_video(file_names, video_metadata, audio_metadata, bitrate, output, output_path):
    if not video_metadata:
        subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["video_only"]}" -y -b:v {bitrate} ".\\tmp\\{file_names["changed_bitrate"]}"')
        subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["changed_bitrate"]}" -i ".\\tmp\\{file_names["audio_only"]}" -y -c copy "{output_path + output}"')
    elif video_metadata:
        if int(video_metadata['format']['size']) + int(audio_metadata['format']['size']) > FILE_SIZE_LIMIT_IN_BYTES:
            subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["video_only"]}" -y -b:v {bitrate} ".\\tmp\\{file_names["changed_bitrate"]}"')
            subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["changed_bitrate"]}" -i ".\\tmp\\{file_names["audio_only"]}" -y -c copy "{output_path + output}"')
        else:
            subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["rescaled"]}" -i ".\\tmp\\{file_names["audio_only"]}" -y -c copy "{output_path + output}"')


file_path = get_file_path()
file_name = get_file_name()
file_names = get_file_endings(file_name)
split_video(file_path, file_names)
video_metadata = get_metadata(file_names['video_only'])
audio_metadata = get_metadata(file_names['audio_only'])
rescale_video(file_names['video_only'], file_names['rescaled'], video_metadata)
rescaled_video_metadata = get_metadata(file_names['rescaled'])
bitrate = determine_target_bitrate(video_metadata, audio_metadata)
process_video(file_names, rescaled_video_metadata, audio_metadata, bitrate, file_names['8mb'], file_path)
